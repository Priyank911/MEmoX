import * as vscode from 'vscode';
import { AuthService, AuthState } from './AuthService';

export class AuthWebview {
    private static readonly viewType = 'memox.auth';
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private authService: AuthService;
    
    constructor(context: vscode.ExtensionContext, authService: AuthService) {
        this.context = context;
        this.authService = authService;
    }

    // Open authentication webview
    public async show(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        // Create and show panel
        this.panel = vscode.window.createWebviewPanel(
            AuthWebview.viewType,
            'MEmoX Authentication',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'resources')]
            }
        );

        // Get logo URI for the webview
        const logoPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icon.svg');
        const logoSrc = this.panel.webview.asWebviewUri(logoPath);

        // Set HTML content
        this.panel.webview.html = this.getHtmlContent(logoSrc);
        
        // Set up message handlers
        this.setupMessageHandlers();

        // Clean up when panel is closed
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }    // Handle messages from the webview
    private setupMessageHandlers(): void {
        if (!this.panel) {
            return;
        }

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'signInWithGitHub':
                        await this.openGitHubAuthInBrowser();
                        break;                    case 'enterToken':
                        await this.promptForDirectToken();
                        break;
                    case 'enterCode':
                        await this.promptForAuthCode();
                        break;
                    case 'testUriHandler':
                        await this.testUriHandler();
                        break;
                    case 'cancel':
                        this.panel?.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }
    
    // Test if VS Code URI handler works
    private async testUriHandler(): Promise<void> {
        const testCode = 'test_code_' + Math.random().toString(36).substring(2, 10);
        const testState = this.authService.generateStateParam();
        
        const testUri = vscode.Uri.parse(`vscode://memox/callback?code=${testCode}&state=${testState}`);            vscode.window.showInformationMessage('MEmoX: Testing URI protocol handler. VS Code should handle this redirect.');
        
        const success = await vscode.env.openExternal(testUri);
        
        if (success) {
            vscode.window.showInformationMessage('MEmoX: Protocol handler test initiated successfully. Check for a redirect.');
        } else {
            vscode.window.showErrorMessage('MEmoX: Protocol handler test failed. VS Code could not open the URI.');
            this.showTroubleshootingOptions();
        }
    }
      // Helper method to show troubleshooting options
    private async showTroubleshootingOptions(): Promise<void> {
        const choice = await vscode.window.showErrorMessage(
            'MEmoX: Protocol handler is not working correctly. This is needed for GitHub OAuth.',
            'Show Troubleshooting Tips',
            'Try Manual Authentication',
            'Open Help Page',
            'Cancel'
        );
        
        if (choice === 'Show Troubleshooting Tips') {
            const troubleshootingTips = [
                'Make sure VS Code is registered as a protocol handler on your system',
                'Check that your GitHub OAuth app has the correct callback URL: vscode://memox/callback',
                'Try restarting VS Code',
                'If using a browser extension that blocks redirects, temporarily disable it',
                'As a workaround, you can use manual code entry or a personal access token'
            ];
            
            vscode.window.showInformationMessage('MEmoX Troubleshooting Tips', ...troubleshootingTips);
        } else if (choice === 'Try Manual Authentication') {
            this.promptForAuthCode();
        } else if (choice === 'Open Help Page') {
            this.openAuthHelperPage();
        }
    }
    
    // Open the auth helper page in the default browser
    private async openAuthHelperPage(): Promise<void> {
        const authHelperPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'auth-helper.html');
        const success = await vscode.env.openExternal(authHelperPath);
        
        if (!success) {
            vscode.window.showErrorMessage('MEmoX: Could not open the auth helper page. Please check documentation for assistance.');
        }
    }// Open GitHub OAuth flow in browser
    public async openGitHubAuthInBrowser(): Promise<void> {
        const clientId = this.authService.getClientId();
        
        if (!clientId) {
            vscode.window.showErrorMessage('MEmoX: GitHub Client ID not configured. Please check your settings.');
            return;
        }

        // Generate state parameter for security
        const state = this.authService.generateStateParam();
        
        // Construct GitHub OAuth URL
        const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
        githubAuthUrl.searchParams.append('client_id', clientId);
        githubAuthUrl.searchParams.append('redirect_uri', 'vscode://memox/callback');
        githubAuthUrl.searchParams.append('scope', 'user:email');
        githubAuthUrl.searchParams.append('state', state);
        
        // Add additional parameters to improve usability
        githubAuthUrl.searchParams.append('allow_signup', 'true');
          // Log the URL we're opening (without exposing the client ID)
        console.log('MEmoX: Opening GitHub auth URL with redirect_uri:', 'vscode://memox/callback');
        console.log('MEmoX: Auth state parameter generated:', state);
        
        // Open GitHub authorization page in browser
        vscode.env.openExternal(vscode.Uri.parse(githubAuthUrl.toString()));
        
        // Show message to user with clear instructions
        vscode.window.showInformationMessage(
            'MEmoX: GitHub sign-in page opened in your browser. After authorizing, you may need to confirm "Open VS Code" prompt.'
        );
    }    // Prompt user to enter a token directly    
    private async promptForDirectToken(): Promise<void> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your GitHub Personal Access Token',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
            validateInput: (value: string) => {
                return value && value.trim().length > 0 ? null : 'Token cannot be empty';
            }
        });

        if (token) {
            // Validate and store token
            const success = await this.authService.setDirectToken(token);
            if (success) {
                this.panel?.dispose();
            }
        }
    }
    
    // Add a method to manually enter an authorization code
    private async promptForAuthCode(): Promise<void> {
        const code = await vscode.window.showInputBox({
            prompt: 'Enter the authorization code from GitHub',
            ignoreFocusOut: true,
            placeHolder: 'The code shown in the browser after authorization',
            validateInput: (value: string) => {
                return value && value.trim().length > 0 ? null : 'Code cannot be empty';
            }
        });

        if (code) {
            // Exchange code for token
            const success = await this.authService.exchangeManualCode(code);
            if (success) {
                this.panel?.dispose();
            }
        }
    }    // Get HTML content for the webview
    private getHtmlContent(logoSrc: vscode.Uri): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MEmoX Authentication</title>
            <style>
                :root {
                    --primary-color: #57BD37;
                    --primary-hover: #69D244;
                    --secondary-color: #333;
                    --text-light: #fff;
                    --text-dark: #333;
                    --card-bg: rgba(25, 25, 30, 0.85);
                    --card-border: rgba(87, 189, 55, 0.3);
                    --button-hover-transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
                    --card-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
                    --green-glow: 0 0 20px rgba(87, 189, 55, 0.6);
                    --glassmorphism-bg: rgba(20, 20, 25, 0.7);
                    --glassmorphism-border: rgba(255, 255, 255, 0.08);
                }
                
                @keyframes fadeIn {
                    0% { opacity: 0; transform: translateY(20px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                
                @keyframes floatAnimation {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-8px); }
                    100% { transform: translateY(0px); }
                }
                
                @keyframes pulseGlow {
                    0% { opacity: 0.5; transform: scale(0.95); }
                    50% { opacity: 1; transform: scale(1.1); }
                    100% { opacity: 0.5; transform: scale(0.95); }
                }
                
                @keyframes gradientFlow {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                
                @keyframes ripple {
                    0% { transform: scale(0); opacity: 1; }
                    100% { transform: scale(4); opacity: 0; }
                }
                  body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    padding: 0;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    color: var(--text-light);
                    background: radial-gradient(circle at top right, rgba(35, 35, 40, 0.95), rgba(18, 18, 20, 0.98)), 
                                url('data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="none" fill-rule="evenodd"%3E%3Cg fill="%239C92AC" fill-opacity="0.05"%3E%3Cpath d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E');
                    position: relative;
                    overflow: hidden;
                    background-attachment: fixed;
                }
                
                body::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(135deg, rgba(87,189,55,0.1) 0%, transparent 40%, rgba(87,189,55,0.1) 100%);
                    background-size: 400% 400%;
                    animation: gradientFlow 15s ease infinite;
                    z-index: -1;
                }
                
                /* Floating particles effect */
                .particle {
                    position: absolute;
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background-color: rgba(87, 189, 55, 0.3);
                    box-shadow: 0 0 10px rgba(87, 189, 55, 0.2);
                    pointer-events: none;
                    z-index: -1;
                }
                
                .auth-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    max-width: 280px;
                    width: 90%;
                    padding: 1rem;
                    border-radius: 15px;
                    background-color: var(--glassmorphism-bg);
                    box-shadow: var(--card-shadow);
                    border: 1px solid var(--glassmorphism-border);
                    backdrop-filter: blur(15px);
                    animation: fadeIn 0.7s ease-out;
                    position: relative;
                    overflow: hidden;
                }
                
                .auth-container::before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    background: radial-gradient(circle at center, rgba(87, 189, 55, 0.05) 0%, transparent 50%);
                    opacity: 0.8;
                    z-index: -1;
                }
                
                .logo-container {
                    position: relative;
                    width: 60px;
                    height: 60px;
                    margin-bottom: 0.6rem;
                    animation: floatAnimation 6s ease-in-out infinite;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .logo {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.2));
                    z-index: 2;
                }
                
                .logo-glow {
                    position: absolute;
                    width: 140%;
                    height: 140%;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(87,189,55,0.4) 0%, rgba(87,189,55,0) 70%);
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 1;
                    animation: pulseGlow 3s infinite ease-in-out;
                    filter: blur(15px);
                }
                  h1 {
                    font-size: 1.4rem;
                    font-weight: 700;
                    margin-bottom: 0.3rem;
                    text-align: center;
                    background: linear-gradient(90deg, #ffffff, #57BD37, #ffffff);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    letter-spacing: -0.5px;
                    animation: gradientFlow 8s linear infinite;
                    text-shadow: 0 0 30px rgba(87, 189, 55, 0.3);
                }
                
                .tagline {
                    font-size: 0.8rem;
                    margin-bottom: 0.8rem;
                    text-align: center;
                    line-height: 1.4;
                    color: rgba(255, 255, 255, 0.85);
                    max-width: 220px;
                    font-weight: 300;
                    letter-spacing: 0.2px;
                }
                
                .buttons-container {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    width: 100%;
                }
                
                .auth-button {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0.5rem 0.7rem;
                    font-size: 0.8rem;
                    font-weight: 500;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: var(--button-hover-transition);
                    border: none;
                    position: relative;
                    overflow: hidden;
                    width: 100%;
                    letter-spacing: 0.3px;
                }
                
                .auth-button .ripple {
                    position: absolute;
                    border-radius: 50%;
                    transform: scale(0);
                    animation: ripple 0.8s linear;
                    background-color: rgba(255, 255, 255, 0.3);
                }
                
                .primary-button {
                    background: linear-gradient(135deg, #57BD37, #4CAF50);
                    color: rgba(255, 255, 255, 0.95);
                    box-shadow: 0 4px 15px rgba(87, 189, 55, 0.4);
                    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                }
                
                .primary-button:hover {
                    background: linear-gradient(135deg, #69D244, #57BD37);
                    transform: translateY(-3px);
                    box-shadow: 0 6px 20px rgba(87, 189, 55, 0.5);
                }
                
                .primary-button:active {
                    transform: translateY(1px);
                }
                
                .secondary-button {
                    background: rgba(255, 255, 255, 0.07);
                    color: var(--text-light);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    backdrop-filter: blur(5px);
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
                }
                
                .secondary-button:hover {
                    background: rgba(255, 255, 255, 0.12);
                    border-color: rgba(255, 255, 255, 0.2);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 15px rgba(0, 0, 0, 0.15);
                }
                
                .utility-button {
                    background: rgba(87, 189, 55, 0.08);
                    color: rgba(255, 255, 255, 0.9);
                    border: 1px solid rgba(87, 189, 55, 0.15);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                }
                
                .utility-button:hover {
                    background: rgba(87, 189, 55, 0.15);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 15px rgba(0, 0, 0, 0.15);
                }
                
                .cancel-button {
                    background-color: transparent;
                    color: rgba(255, 255, 255, 0.6);
                    padding: 0.3rem;
                    margin-top: 0.6rem;
                    font-size: 0.85rem;
                    transition: all 0.2s ease;
                }
                
                .cancel-button:hover {
                    color: rgba(255, 255, 255, 0.9);
                    transform: translateY(-1px);
                }
                  .button-icon {
                    margin-right: 0.75rem;
                    width: 20px;
                    height: 20px;
                    flex-shrink: 0;
                    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
                }
                
                .button-text {
                    flex-grow: 1;
                    text-align: center;
                }
                
                .divider-container {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    margin: 1rem 0 0.8rem;
                    color: rgba(255, 255, 255, 0.5);
                }
                
                .divider-line {
                    flex-grow: 1;
                    height: 1px;
                    background-image: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.15), transparent);
                }
                
                .divider-text {
                    padding: 0 1.2rem;
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    font-weight: 500;
                    color: rgba(255, 255, 255, 0.4);
                }
                
                .tooltip {
                    position: absolute;
                    bottom: -2.8rem;
                    left: 50%;
                    transform: translateX(-50%) translateY(10px);
                    background-color: rgba(15, 15, 20, 0.9);
                    color: white;
                    padding: 0.6rem 1.2rem;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    opacity: 0;
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    pointer-events: none;
                    white-space: nowrap;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .auth-button:hover .tooltip {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
                
                /* Decorative elements */
                .corner-decor {
                    position: absolute;
                    width: 100px;
                    height: 100px;
                    pointer-events: none;
                    opacity: 0.5;
                }
                
                .top-right {
                    top: -20px;
                    right: -20px;
                    background: radial-gradient(circle at top right, rgba(87, 189, 55, 0.3), transparent 70%);
                    filter: blur(15px);
                }
                
                .bottom-left {
                    bottom: -20px;
                    left: -20px;
                    background: radial-gradient(circle at bottom left, rgba(87, 189, 55, 0.2), transparent 70%);
                    filter: blur(15px);
                }
                
                /* Dot pattern overlay */
                .dot-overlay {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    top: 0;
                    left: 0;
                    opacity: 0.4;
                    pointer-events: none;
                    z-index: -1;
                    background-image: radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px);
                    background-size: 20px 20px;
                }
                
                @media (max-width: 480px) {
                    .auth-container {
                        padding: 2.5rem 1.8rem;
                    }
                    
                    h1 {
                        font-size: 2rem;
                    }
                    
                    .tagline {
                        font-size: 1rem;
                        margin-bottom: 2rem;
                    }
                    
                    .logo-container {
                        width: 110px;
                        height: 110px;
                        margin-bottom: 1.5rem;
                    }
                }
            </style>
        </head>
        <body>
            <!-- Floating particles will be added by JS -->
            <div class="auth-container">
                <div class="corner-decor top-right"></div>
                <div class="corner-decor bottom-left"></div>
                <div class="dot-overlay"></div>
                
                <div class="logo-container">
                    <img src="${logoSrc}" alt="MEmoX Logo" class="logo">
                    <div class="logo-glow"></div>
                </div>
                
                <h1>Welcome to MEmoX</h1>
                <p class="tagline">Sign in to unlock the full power of intelligent coding assistance with advanced memory features. Your code stays private and secure.</p>
                  <div class="buttons-container">
                    <button id="githubButton" class="auth-button primary-button">
                        <svg class="button-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                        </svg>
                        <span class="button-text">Sign in with GitHub</span>
                    </button>
                    
                    <div class="divider-container">
                        <div class="divider-line"></div>
                        <span class="divider-text">Alternative Options</span>
                        <div class="divider-line"></div>
                    </div>
                    
                    <button id="tokenButton" class="auth-button secondary-button">
                        <svg class="button-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <span class="button-text">Use Personal Access Token</span>
                    </button>
                    
                    <button id="codeButton" class="auth-button secondary-button">
                        <svg class="button-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        <span class="button-text">Enter Authorization Code</span>
                    </button>
                    
                    <button id="testUriButton" class="auth-button utility-button">
                        <svg class="button-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <span class="button-text">Test URI Handler</span>
                        <span class="tooltip">Verify redirect functionality</span>
                    </button>
                    
                    <button id="cancelButton" class="auth-button cancel-button">
                        Cancel
                    </button>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // Create and animate floating particles
                function createParticles() {
                    const particleCount = 15;
                    const colors = ['rgba(87, 189, 55, 0.3)', 'rgba(87, 189, 55, 0.2)', 'rgba(255, 255, 255, 0.2)'];
                    
                    for (let i = 0; i < particleCount; i++) {
                        const particle = document.createElement('div');
                        particle.className = 'particle';
                        
                        // Random position
                        const x = Math.random() * window.innerWidth;
                        const y = Math.random() * window.innerHeight;
                        
                        // Random size between 2-4px
                        const size = Math.random() * 2 + 2;
                        
                        // Random animation duration
                        const duration = Math.random() * 15 + 10;
                        
                        // Random color
                        const color = colors[Math.floor(Math.random() * colors.length)];
                        
                        // Apply styles
                        particle.style.left = \`\${x}px\`;
                        particle.style.top = \`\${y}px\`;
                        particle.style.width = \`\${size}px\`;
                        particle.style.height = \`\${size}px\`;
                        particle.style.backgroundColor = color;
                        
                        // Animation
                        particle.style.animation = \`floatAnimation \${duration}s infinite ease-in-out\`;
                        particle.style.animationDelay = \`\${Math.random() * 5}s\`;
                        
                        document.body.appendChild(particle);
                        
                        // Move particles in random directions
                        animate(particle, x, y);
                    }
                }
                
                function animate(particle, startX, startY) {
                    const moveX = startX + (Math.random() - 0.5) * 100;
                    const moveY = startY + (Math.random() - 0.5) * 100;
                    
                    particle.animate([
                        { transform: \`translate(0, 0)\` },
                        { transform: \`translate(\${moveX - startX}px, \${moveY - startY}px)\` }
                    ], {
                        duration: 15000 + Math.random() * 10000,
                        direction: 'alternate',
                        iterations: Infinity,
                        easing: 'ease-in-out'
                    });
                }
                
                // Create ripple effect on button click
                function createRipple(event) {
                    const button = event.currentTarget;
                    
                    const circle = document.createElement('span');
                    const diameter = Math.max(button.clientWidth, button.clientHeight);
                    const radius = diameter / 2;
                    
                    circle.style.width = circle.style.height = \`\${diameter}px\`;
                    circle.style.left = \`\${event.clientX - button.getBoundingClientRect().left - radius}px\`;
                    circle.style.top = \`\${event.clientY - button.getBoundingClientRect().top - radius}px\`;
                    circle.classList.add('ripple');
                    
                    // Remove existing ripples
                    const ripple = button.getElementsByClassName('ripple')[0];
                    if (ripple) {
                        ripple.remove();
                    }
                    
                    button.appendChild(circle);
                }
                
                // Initialize particles
                document.addEventListener('DOMContentLoaded', function() {
                    createParticles();
                });
                
                // Add button click animations and ripple effect
                document.querySelectorAll('.auth-button').forEach(button => {
                    button.addEventListener('mousedown', function(e) {
                        this.style.transform = 'scale(0.98)';
                        createRipple(e);
                    });
                    
                    button.addEventListener('mouseup', function() {
                        this.style.transform = '';
                    });
                    
                    button.addEventListener('mouseleave', function() {
                        this.style.transform = '';
                    });
                });
                
                // Button event handlers with transition effects
                document.getElementById('githubButton').addEventListener('click', () => {
                    animateButtonClick('githubButton');
                    setTimeout(() => {
                        vscode.postMessage({
                            command: 'signInWithGitHub'
                        });
                    }, 300);
                });
                
                document.getElementById('tokenButton').addEventListener('click', () => {
                    animateButtonClick('tokenButton');
                    vscode.postMessage({
                        command: 'enterToken'
                    });
                });
                
                document.getElementById('codeButton').addEventListener('click', () => {
                    animateButtonClick('codeButton');
                    vscode.postMessage({
                        command: 'enterCode'
                    });
                });
                
                document.getElementById('testUriButton').addEventListener('click', () => {
                    animateButtonClick('testUriButton');
                    vscode.postMessage({
                        command: 'testUriHandler'
                    });
                });
                
                document.getElementById('cancelButton').addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'cancel'
                    });
                });
                
                function animateButtonClick(id) {
                    const button = document.getElementById(id);
                    button.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        button.style.transform = '';
                    }, 200);
                }
            </script>
        </body>
        </html>`;
    }
}
