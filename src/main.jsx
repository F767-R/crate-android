import { h } from 'preact';
import { render } from 'preact';
import App from './components/App.jsx';
import './utils/playerShim.js';
import styles from './styles.css?inline';

// Inject CSS as a style tag for reliable loading in Capacitor WebView
const styleTag = document.createElement('style');
styleTag.textContent = styles;
document.head.appendChild(styleTag);

render(h(App), document.getElementById('app'));