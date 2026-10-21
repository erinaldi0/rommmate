import React from 'react';
import { render } from 'react-tela/render';
import { App } from './App';

// High-quality image smoothing for the canvas (matters for cover art).
const ctx = screen.getContext('2d');
if (ctx) {
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
}

console.log('rommate: starting (nx.js + react-tela)');
render(<App />, screen);
