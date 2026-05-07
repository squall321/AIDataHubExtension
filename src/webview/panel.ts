import * as vscode from 'vscode';
import { ConfigStore } from '../state/configStore';
import { ApiClient, ApiError } from '../client/apiClient';

const VIEW_TYPE = 'aidh.uploader';

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'getConfig' }
  | { type: 'testConnection'; baseUrl: string; apiKey: string }
  | { type: 'saveConfig'; baseUrl: string; apiKey: string }
  | { type: 'reset' };

type HostToWebview =
  | { type: 'config'; baseUrl: string; hasApiKey: boolean; connected: boolean }
  | { type: 'connection'; ok: boolean; error?: string; health?: unknown };

export class UploaderPanel {
  private static current: UploaderPanel | undefined;

  static show(context: vscode.ExtensionContext, store: ConfigStore): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (UploaderPanel.current) {
      UploaderPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'AI Data Hub',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    UploaderPanel.current = new UploaderPanel(panel, context, store);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
    private readonly store: ConfigStore,
  ) {
    this.panel.webview.html = this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHost) => this.onMessage(msg),
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    UploaderPanel.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private post(msg: HostToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'getConfig': {
        const snap = await this.store.snapshot();
        this.post({ type: 'config', ...snap });
        return;
      }
      case 'testConnection': {
        await this.testConnection(msg.baseUrl, msg.apiKey);
        return;
      }
      case 'saveConfig': {
        await this.testConnection(msg.baseUrl, msg.apiKey, /*persistOnSuccess*/ true);
        return;
      }
      case 'reset': {
        await this.store.reset();
        const snap = await this.store.snapshot();
        this.post({ type: 'config', ...snap });
        return;
      }
    }
  }

  private async testConnection(
    baseUrl: string,
    apiKey: string,
    persistOnSuccess = false,
  ): Promise<void> {
    const normalizedUrl = baseUrl.trim();
    if (!normalizedUrl) {
      this.post({ type: 'connection', ok: false, error: 'Server URL is empty.' });
      return;
    }
    const client = new ApiClient(normalizedUrl, apiKey || undefined);
    try {
      const health = await client.health();
      if (apiKey) {
        await client.verifyKey();
      }
      if (persistOnSuccess) {
        await this.store.setBaseUrl(normalizedUrl);
        if (apiKey) await this.store.setApiKey(apiKey);
        await this.store.setConnected(true);
        const snap = await this.store.snapshot();
        this.post({ type: 'config', ...snap });
      }
      this.post({ type: 'connection', ok: true, health });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `[${err.code}] ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.post({ type: 'connection', ok: false, error: message });
    }
  }

  private render(): string {
    const nonce = randomNonce();
    const csp =
      `default-src 'none'; ` +
      `style-src 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; ` +
      `connect-src http: https:;`;
    return /* html */ `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>AI Data Hub</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 24px;
      }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p.subtle { color: var(--vscode-descriptionForeground); margin-top: 0; }
      label { display: block; margin: 16px 0 4px; font-size: 12px; opacity: 0.85; }
      input[type=text], input[type=password] {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 2px;
        box-sizing: border-box;
      }
      .row { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
      button {
        padding: 6px 14px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 2px;
        cursor: pointer;
      }
      button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .status { margin-top: 16px; padding: 8px 12px; border-radius: 2px; display: none; }
      .status.ok { background: rgba(0, 160, 0, 0.15); color: var(--vscode-testing-iconPassed, #4caf50); display: block; }
      .status.err { background: rgba(200, 0, 0, 0.15); color: var(--vscode-errorForeground, #f44336); display: block; }
      .hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 12px; }
      .placeholder { padding: 32px; border: 1px dashed var(--vscode-panel-border, #444); text-align: center; border-radius: 4px; color: var(--vscode-descriptionForeground); }
      .toolbar { display: flex; gap: 8px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <div id="welcome">
      <h1>👋 Connect to your AI Data Hub server</h1>
      <p class="subtle">Enter your backend URL and API key. The key is stored in VS Code SecretStorage.</p>

      <label for="url">Server URL</label>
      <input id="url" type="text" placeholder="http://10.10.20.5:8000" />

      <label for="key">API Key</label>
      <input id="key" type="password" placeholder="••••••••••••" />

      <div class="toolbar">
        <button id="test">Test Connection</button>
        <button id="save" class="secondary">Save &amp; Continue</button>
      </div>

      <div id="status" class="status"></div>
      <p class="hint">Backend changes still in flight: <code>GET /api/meta/options</code>, <code>POST /api/auth/keys/verify</code>. The extension falls back gracefully until they ship.</p>
    </div>

    <div id="connected" style="display:none;">
      <h1>✅ Connected</h1>
      <p class="subtle" id="connected-url"></p>
      <div class="placeholder">
        Drop zone &amp; metadata form will land in the next commit.<br/>
        <small>(see docs/ux_flow.md → screen 2)</small>
      </div>
      <div class="toolbar">
        <button id="reset" class="secondary">Reset Connection</button>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const urlEl = document.getElementById('url');
      const keyEl = document.getElementById('key');
      const statusEl = document.getElementById('status');
      const welcomeEl = document.getElementById('welcome');
      const connectedEl = document.getElementById('connected');
      const connectedUrlEl = document.getElementById('connected-url');

      function showStatus(text, ok) {
        statusEl.textContent = text;
        statusEl.className = 'status ' + (ok ? 'ok' : 'err');
      }
      function clearStatus() {
        statusEl.textContent = '';
        statusEl.className = 'status';
      }

      document.getElementById('test').addEventListener('click', () => {
        clearStatus();
        vscode.postMessage({ type: 'testConnection', baseUrl: urlEl.value, apiKey: keyEl.value });
      });
      document.getElementById('save').addEventListener('click', () => {
        clearStatus();
        vscode.postMessage({ type: 'saveConfig', baseUrl: urlEl.value, apiKey: keyEl.value });
      });
      document.getElementById('reset').addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'config') {
          urlEl.value = msg.baseUrl || '';
          if (msg.connected) {
            welcomeEl.style.display = 'none';
            connectedEl.style.display = 'block';
            connectedUrlEl.textContent = 'Connected to: ' + (msg.baseUrl || '(unknown)');
          } else {
            welcomeEl.style.display = 'block';
            connectedEl.style.display = 'none';
          }
        } else if (msg.type === 'connection') {
          if (msg.ok) {
            showStatus('Connection OK' + (msg.health && msg.health.version ? ' — server ' + msg.health.version : ''), true);
          } else {
            showStatus('Failed: ' + (msg.error || 'unknown error'), false);
          }
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
