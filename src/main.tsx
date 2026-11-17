import { render } from 'preact';
import { App } from './app';
import { initEngine } from './engine/install';
import './styles.css';

// The service worker lets the app open with the network off. It is registered before
// the engine is installed so that verified engine files are served from this device.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

const root = document.getElementById('app')!;
root.textContent = ''; // clear the loading heading written in index.html
render(<App />, root);
initEngine();
