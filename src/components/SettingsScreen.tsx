import React, { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text, useDimensions } from 'react-tela';
import { SwkbdType } from '@nx.js/constants';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { getVirtualKeyboard } from '../vk';
import type { Config } from '../config';

interface Props {
	/** The config as last saved (pre-filled into the rows). */
	initial: Config;
	/** Status line (connection result), shown above the footer. */
	status: string;
	/** True while a connection attempt is in flight. */
	busy: boolean;
	onSave: (cfg: Config) => void;
}

type Field = 'baseUrl' | 'token';

const ROWS = ['Base URL', 'API Token', 'Save & Connect'] as const;
const ROW_W = 920;

function mask(v: string): string {
	if (!v) return '(not set)';
	if (v.length <= 10) return v;
	return v.slice(0, 10) + '•'.repeat(Math.min(16, v.length - 10));
}

export function SettingsScreen({ initial, status, busy, onSave }: Props) {
	const dims = useDimensions();
	const [cfg, setCfg] = useState<Config>(initial);
	const [focus, setFocus] = useState(0);
	const [draft, setDraft] = useState('');
	const pending = useRef<Field | null>(null);
	const vk = getVirtualKeyboard();

	function openField(field: Field) {
		if (!vk || busy) return;
		pending.current = field;
		vk.type = SwkbdType.Normal;
		vk.okButtonText = 'Done';
		vk.value = field === 'baseUrl' ? cfg.baseUrl : cfg.token;
		setDraft(vk.value);
		vk.show();
	}

	// Commit the keyboard contents when it closes (OK, Back, or any other
	// path that hides it). `pending` guards against stray commits.
	useEffect(() => {
		if (!vk) return;
		const commit = () => {
			const field = pending.current;
			if (!field) return;
			pending.current = null;
			const value = vk.value;
			setDraft('');
			setCfg((c) => (field === 'baseUrl' ? { ...c, baseUrl: value } : { ...c, token: value }));
		};
		const onGeom = () => {
			if (vk.boundingRect.height === 0) commit();
		};
		const onInput = () => setDraft(vk.value);
		vk.addEventListener('submit', commit);
		vk.addEventListener('cancel', commit);
		vk.addEventListener('geometrychange', onGeom);
		vk.addEventListener('change', onInput);
		vk.addEventListener('cursormove', onInput);
		return () => {
			vk.removeEventListener('submit', commit);
			vk.removeEventListener('cancel', commit);
			vk.removeEventListener('geometrychange', onGeom);
			vk.removeEventListener('change', onInput);
			vk.removeEventListener('cursormove', onInput);
		};
	}, [vk]);

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), []);
	useDirection('Down', () => setFocus((f) => Math.min(ROWS.length - 1, f + 1)), []);

	useGamepadButton(
		'A',
		() => {
			if (focus === 0) openField('baseUrl');
			else if (focus === 1) openField('token');
			else if (!busy) onSave(cfg);
		},
		[focus, cfg, busy],
	);
	useGamepadButton(
		'ZR',
		() => {
			if (focus === 0) openField('baseUrl');
			else if (focus === 1) openField('token');
		},
		[focus],
	);

	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;

	const rowValue = (i: number): string => {
		if (i === 0) return pending.current === 'baseUrl' && draft !== '' ? draft : cfg.baseUrl || '(not set)';
		if (i === 1) return pending.current === 'token' && draft !== '' ? draft : mask(cfg.token);
		return busy ? 'connecting…' : 'A to save & open library';
	};

	const statusError = /fail|cannot|invalid/i.test(status);

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#101018" />

			<Text x={cx} y={64} fontSize={64} fill="#ffffff" textAlign="center">
				RomMmate
			</Text>
			<Text x={cx} y={150} fontSize={28} fill="#9a9ab0" textAlign="center">
				RomM settings
			</Text>

			{ROWS.map((label, i) => {
				const y = 230 + i * 88;
				const isFocused = i === focus;
				return (
					<Group key={label} x={rowX} y={y} width={ROW_W} height={70} borderRadius={10}>
						<Rect
							width={ROW_W}
							height={70}
							fill={isFocused ? '#232338' : '#171722'}
							stroke={isFocused ? '#5b8cff' : '#262636'}
							lineWidth={isFocused ? 3 : 1}
							borderRadius={10}
						/>
						<Text x={24} y={22} fontSize={26} fill={isFocused ? '#ffffff' : '#9a9ab0'}>
							{label}
						</Text>
						<Text x={280} y={22} maxWidth={ROW_W - 310} fontSize={24} fill="#c8c8e0" overflow="ellipsis">
							{rowValue(i)}
						</Text>
					</Group>
				);
			})}

			{status !== '' && (
				<Text x={cx} y={530} fontSize={26} fill={statusError ? '#e06060' : '#9a9ab0'} textAlign="center">
					{status}
				</Text>
			)}

			<Text x={cx} y={dims.height - 52} fontSize={22} fill="#6a6a85" textAlign="center">
				A / ZR to edit a field · A on the last row to connect
			</Text>
		</>
	);
}
