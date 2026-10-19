#---------------------------------------------------------------------------------
.SUFFIXES:
#---------------------------------------------------------------------------------

ifeq ($(strip $(DEVKITPRO)),)
$(error "Please set DEVKITPRO in your environment. export DEVKITPRO=<path to>/devkitpro")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITPRO)/libnx/switch_rules

# `borealis-resources` (defined below) is the first target in this file, which
# would make it the default goal. Force `all` so a plain `make` builds the app.
.DEFAULT_GOAL := all

#---------------------------------------------------------------------------------
# TARGET is the name of the output
# BUILD   is the directory where object/intermediate files go
# SOURCES are the directories containing source code
# INCLUDES are the directories containing headers
# ROMFS   is the directory whose contents become the RomFS (embedded in the .nro)
#---------------------------------------------------------------------------------
TARGET      := rommate
BUILD       := build
SOURCES     := src
INCLUDES    := include
ROMFS       := romfs

# Borealis (natinusala/borealis @ main) — the XML / BRLS_BIND "wiliwili" rewrite.
# Renders via deko3d, input via the vendored switch-libpulsar.
BOREALIS_PATH := lib/borealis

APP_TITLE    := RomM
APP_AUTHOR   := You
APP_VERSION  := 0.1.0

# No icon.jpg is shipped; skip embedding one.
NO_ICON := 1

# Borealis' deko3d backend loads its compiled GLSL shaders from romfs/shaders/.
OUT_SHADERS  := shaders

#---------------------------------------------------------------------------------
# Code generation options (mirrors Borealis' demo so the deko3d backend builds
# identically to the upstream project).
#---------------------------------------------------------------------------------
ARCH     := -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE

CFLAGS   := -g -Wall -O2 -ffunction-sections $(ARCH) $(DEFINES)
CFLAGS   += $(INCLUDE) -D__SWITCH__

CXXFLAGS := $(CFLAGS) -std=gnu++20 -O2 -Wno-volatile

ASFLAGS  := -g $(ARCH)
LDFLAGS  = -specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)

# Networking: the devkitPro switch-curl portlib is built with libnx as its
# TLS backend (`curl --with-libnx`), so -lnx provides HTTPS — no separate
# mbedtls is needed. -lz for curl's zlib support. -lcurl must come before
# -lnx (single-pass linker: curl's unresolved refs need the libs that follow).
# borealis.mk prepends -ldeko3d -lm.
LIBS     := -lcurl -lz -lnx

# deko3d installs into $(LIBNX); curl/zlib/glm install into the portlibs.
LIBDIRS  := $(PORTLIBS) $(LIBNX)

# Adds Borealis sources/includes, -ldeko3d, switch-libpulsar and
# -DBRLS_RESOURCES="romfs:/". Must come AFTER BOREALIS_PATH and LIBDIRS.
include $(TOPDIR)/$(BOREALIS_PATH)/library/borealis.mk

#---------------------------------------------------------------------------------
# Local Borealis fixes live in lib/borealis.patch (the submodule is pinned at a
# public commit, so it can't carry them). Applied idempotently before the build;
# the `all` prerequisite above guarantees this finishes before any source compiles.
#---------------------------------------------------------------------------------
.PHONY: borealis-patch
borealis-patch:
	@[ -f "$(BOREALIS_PATH)/library/borealis.mk" ] || { echo "ERROR: lib/borealis submodule not checked out — run: git submodule update --init"; exit 1; }
	@if git -C "$(BOREALIS_PATH)" apply --check "$(TOPDIR)/lib/borealis.patch" 2>/dev/null; then \
		git -C "$(BOREALIS_PATH)" apply "$(TOPDIR)/lib/borealis.patch" && echo "Applied lib/borealis.patch"; \
	elif git -C "$(BOREALIS_PATH)" apply -R --check "$(TOPDIR)/lib/borealis.patch" 2>/dev/null; then \
		echo "lib/borealis.patch already applied"; \
	else \
		echo "ERROR: lib/borealis.patch no longer applies — the submodule moved off its pinned commit"; exit 1; \
	fi

#---------------------------------------------------------------------------------
# Borealis reads its bundled resources (fonts/themes/img/i18n/xml) from the
# romfs root (BRLS_RESOURCES="romfs:/"), so merge them into our romfs dir
# alongside our own xml/main.xml and posters/.
#---------------------------------------------------------------------------------
.PHONY: borealis-resources
borealis-resources:
	@[ -d "$(BOREALIS_PATH)/resources" ] || { echo "ERROR: Borealis resources missing — re-check out the lib/borealis submodule"; exit 1; }
	@cp -r "$(BOREALIS_PATH)/resources/." "$(ROMFS)/"
	@echo "Synced Borealis resources into $(ROMFS)/"

#---------------------------------------------------------------------------------
# Build-target plumbing below mirrors Borealis' demo Makefile verbatim (with the
# borealis-resources merge added to `all`) so shaders + the romfs archive are
# produced exactly as the upstream project expects. Do not replace this with a
# plain `include switch_targets` — the shader rules are required.
#---------------------------------------------------------------------------------
ifneq ($(BUILD),$(notdir $(CURDIR)))
#---------------------------------------------------------------------------------

export OUTPUT   := $(CURDIR)/$(TARGET)
export TOPDIR   := $(CURDIR)

export VPATH    := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) \
		$(foreach dir,$(DATA),$(CURDIR)/$(dir))

export DEPSDIR  := $(CURDIR)/$(BUILD)

CFILES    := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
CPPFILES  := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
SFILES    := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.s)))
GLSLFILES := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.glsl)))
BINFILES  := $(foreach dir,$(DATA),$(notdir $(wildcard $(dir)/*.*)))

ifeq ($(strip $(CPPFILES)),)
	export LD := $(CC)
else
	export LD := $(CXX)
endif

export OFILES_BIN := $(addsuffix .o,$(BINFILES))
export OFILES_SRC := $(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(SFILES:.s=.o)
export OFILES     := $(OFILES_BIN) $(OFILES_SRC)
export HFILES_BIN := $(addsuffix .h,$(subst .,_,$(BINFILES)))

ifneq ($(strip $(ROMFS)),)
	ROMFS_TARGETS :=
	ROMFS_FOLDERS :=
	ifneq ($(strip $(OUT_SHADERS)),)
		ROMFS_SHADERS := $(ROMFS)/$(OUT_SHADERS)
		ROMFS_TARGETS += $(patsubst %.glsl, $(ROMFS_SHADERS)/%.dksh, $(GLSLFILES))
		ROMFS_FOLDERS += $(ROMFS_SHADERS)
	endif
	export ROMFS_DEPS := $(foreach file,$(ROMFS_TARGETS),$(CURDIR)/$(file))
endif

export INCLUDE := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) \
		$(foreach dir,$(LIBDIRS),-I$(dir)/include) \
		-I$(CURDIR)/$(BUILD)

export LIBPATHS := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)

ifeq ($(strip $(ICON)),)
	icons := $(wildcard *.jpg)
	ifneq (,$(findstring $(TARGET).jpg,$(icons)))
		export APP_ICON := $(TOPDIR)/$(TARGET).jpg
	else
		ifneq (,$(findstring icon.jpg,$(icons)))
			export APP_ICON := $(TOPDIR)/icon.jpg
		endif
	endif
else
	export APP_ICON := $(TOPDIR)/$(ICON)
endif

ifeq ($(strip $(NO_ICON)),)
	export NROFLAGS += --icon=$(APP_ICON)
endif

ifeq ($(strip $(NO_NACP)),)
	export NROFLAGS += --nacp=$(CURDIR)/$(TARGET).nacp
endif

ifneq ($(ROMFS),)
	export NROFLAGS += --romfsdir=$(CURDIR)/$(ROMFS)
endif

.PHONY: all clean

# Apply the Borealis patch, sync its resources + compile shaders, then build in $(BUILD).
all: borealis-patch borealis-resources $(ROMFS_TARGETS) | $(BUILD)
	@MSYS2_ARG_CONV_EXCL="-D;$(MSYS2_ARG_CONV_EXCL)" $(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

$(BUILD):
	@mkdir -p $@

ifneq ($(strip $(ROMFS_TARGETS)),)

$(ROMFS_TARGETS): | $(ROMFS_FOLDERS)

$(ROMFS_FOLDERS):
	@mkdir -p $@

$(ROMFS_SHADERS)/%_vsh.dksh: %_vsh.glsl
	@echo {vert} $(notdir $<)
	@uam -s vert -o $@ $<

$(ROMFS_SHADERS)/%_tcsh.dksh: %_tcsh.glsl
	@echo {tess_ctrl} $(notdir $<)
	@uam -s tess_ctrl -o $@ $<

$(ROMFS_SHADERS)/%_tesh.dksh: %_tesh.glsl
	@echo {tess_eval} $(notdir $<)
	@uam -s tess_eval -o $@ $<

$(ROMFS_SHADERS)/%_gsh.dksh: %_gsh.glsl
	@echo {geom} $(notdir $<)
	@uam -s geom -o $@ $<

$(ROMFS_SHADERS)/%_fsh.dksh: %_fsh.glsl
	@echo {frag} $(notdir $<)
	@uam -s frag -o $@ $<

$(ROMFS_SHADERS)/%.dksh: %.glsl
	@echo {comp} $(notdir $<)
	@uam -s comp -o $@ $<

endif

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(ROMFS_FOLDERS) $(TARGET).nro $(TARGET).nacp $(TARGET).elf $(TARGET).nsp

#---------------------------------------------------------------------------------
# NSP packaging: tools/build_nsp.sh turns rommate.elf/.nacp/romfs into an
# installable rommate.nsp via hacBrewPack (cloned + patched into build/).
#   make nsp                       # KEYSET defaults to ~/Downloads/prod.keys
#   make nsp KEYSET=/path/keys
# Installs only on an Atmosphere console with sigpatch (see README).
#---------------------------------------------------------------------------------
.PHONY: nsp
nsp: all
	@KEYSET="$(KEYSET)" $(CURDIR)/tools/build_nsp.sh

# Verify the built NSP with hactool (hashes + byte-for-byte round-trip).
.PHONY: verify
verify:
	@KEYSET="$(KEYSET)" $(CURDIR)/tools/verify_nsp.sh

#---------------------------------------------------------------------------------
else
.PHONY:	all

DEPENDS := $(OFILES:.o=.d)

#---------------------------------------------------------------------------------
# main targets
#---------------------------------------------------------------------------------
all	:	$(OUTPUT).nro

ifeq ($(strip $(NO_NACP)),)
$(OUTPUT).nro	:	$(OUTPUT).elf $(OUTPUT).nacp $(ROMFS_DEPS)
else
$(OUTPUT).nro	:	$(OUTPUT).elf $(ROMFS_DEPS)
endif

$(OUTPUT).elf	:	$(OFILES)

$(OFILES_SRC)	:	$(HFILES_BIN)

#---------------------------------------------------------------------------------
# you need a rule like this for each extension you use as binary data
#---------------------------------------------------------------------------------
%.bin.o	%_bin.h :	%.bin
	@echo $(notdir $<)
	@$(bin2o)

-include $(DEPENDS)

#---------------------------------------------------------------------------------
endif
#---------------------------------------------------------------------------------
