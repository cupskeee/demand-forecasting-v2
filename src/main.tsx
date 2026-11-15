import { render } from 'preact';
import { App } from './app';
import { initEngine } from './engine/install';
import './styles.css';

// The service worker lets the app open with the network off. It is registered before
// the engine is installed so that verified engine files are served from this device.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

render(<App />, document.getElementById('app')!);
initEngine();
