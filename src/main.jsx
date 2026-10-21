import { h } from 'preact';
import { render } from 'preact';
import App from './components/App.jsx';
import './utils/playerShim.js';
import styles from './styles.css?inline';
// Bundled Latin subsets: no render-blocking request to Google Fonts, and they work offline.
import inter400 from '@fontsource/inter/latin-400.css?inline';
import inter500 from '@fontsource/inter/latin-500.css?inline';
import inter600 from '@fontsource/inter/latin-600.css?inline';
import fraunces400 from '@fontsource/fraunces/latin-400.css?inline';
import fraunces500 from '@fontsource/fraunces/latin-500.css?inline';
import fraunces600 from '@fontsource/fraunces/latin-600.css?inline';
import mono400 from '@fontsource/jetbrains-mono/latin-400.css?inline';
import mono500 from '@fontsource/jetbrains-mono/latin-500.css?inline';
import { initTheme } from './stores/theme.js';

// Inject CSS as a style tag for reliable loading in Capacitor WebView
const styleTag = document.createElement('style');
styleTag.textContent = [inter400, inter500, inter600, fraunces400, fraunces500, fraunces600, mono400, mono500, styles].join('\n');
document.head.appendChild(styleTag);

initTheme();
render(h(App), document.getElementById('app'));