import React from 'react';
import { render } from 'react-tela/render';
import { App } from './App';
import { getFatalMessage, installErrorTrap, reportFatalError } from './errors';
import { BUILD_ID } from './version';

installErrorTrap();

// High-quality image smoothing for the canvas (matters for cover art).
const ctx = screen.getContext('2d');
if (ctx) {
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
}

try {
	render(<App />, screen);
} catch (err) {
	// The very first paint failed and nothing is mounted, so the error has to
	// be painted straight onto the canvas — otherwise the screen stays blank
	// and the failure is invisible.
	reportFatalError(err);
	paintFatal(ctx, getFatalMessage() ?? 'unknown error');
}

/** Last-resort error display, drawn with raw canvas calls. */
function paintFatal(context: CanvasRenderingContext2D | null, message: string): void {
	if (!context) return;
	try {
		const w = context.canvas.width;
		const h = context.canvas.height;
		context.fillStyle = '#1a0c0c';
		context.fillRect(0, 0, w, h);
		context.fillStyle = '#ff8a8a';
		context.font = '28px sans-serif';
		context.fillText('RomMmate - render error', 40, 60);
		context.fillStyle = '#ffb3b3';
		context.font = '16px sans-serif';
		context.fillText(`build ${BUILD_ID}`, 40, h - 40);
		context.fillText(message.slice(0, 300), 40, 110);
	} catch {
		/* nothing more we can do */
	}
}
