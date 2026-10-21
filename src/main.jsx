import { h } from 'preact';
import { render } from 'preact';
import App from './components/App.jsx';
import './utils/playerShim.js';
import styles from './styles.css?inline';
import { initTheme } from './stores/theme.js';

// Inject CSS as a style tag for reliable loading in Capacitor WebView
const styleTag = document.createElement('style');
styleTag.textContent = styles;
document.head.appendChild(styleTag);

initTheme();
render(h(App), document.getElementById('app'));