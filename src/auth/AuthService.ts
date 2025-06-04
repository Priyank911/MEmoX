import * as vscode from 'vscode';
import axios from 'axios';
import * as crypto from 'crypto';

// AuthState enum to track authentication states
export enum AuthState {
    SignedOut = 'SignedOut',
    SigningIn = 'SigningIn',
    SignedIn = 'SignedIn',
    Error = 'Error'
}

// Authentication service class
export class AuthService {
    private static instance: AuthService;
    private context: vscode.ExtensionContext;
    private _stateChanged = new vscode.EventEmitter<AuthState>();
    
    // Public event that can be subscribed to for auth state changes
    public readonly onStateChanged = this._stateChanged.event;
    private currentState: AuthState = AuthState.SignedOut;

    // Private constructor for singleton pattern
    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        
        // Initialize state based on whether we have a token
        const token = this.getAuthToken();
        if (token) {
            // Validate the token on startup
            this.validateToken(token).then(isValid => {
                if (isValid) {
                    this.updateState(AuthState.SignedIn);
                } else {
                    // Clear invalid token
                    this.setAuthToken('');
                    this.updateState(AuthState.SignedOut);
                }
            });
        } else {
            this.updateState(AuthState.SignedOut);
        }
        
        // Validate the OAuth configuration on startup
        this.validateOAuthConfig();
    }
      // Validate GitHub OAuth configuration
    private validateOAuthConfig(): void {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        
        if (!clientId || !clientSecret) {
            console.warn('MEmoX: GitHub OAuth credentials are missing or incomplete.');
            return;
        }
        
        // Additional validation if needed
        if (clientId === 'Ov23limgWcXCUA0lTShe' && clientSecret.startsWith('a1f84c79')) {
            console.warn('MEmoX: Using example GitHub OAuth credentials. Please configure your own OAuth app.');
        }
        
        console.log('MEmoX: GitHub OAuth configuration validated. Client ID available:', !!clientId);
    }

    // Get singleton instance
    public static getInstance(context: vscode.ExtensionContext): AuthService {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService(context);
        }
        return AuthService.instance;
    }

    // Generate a secure state parameter for OAuth flow
    public generateStateParam(): string {
        const state = crypto.randomBytes(16).toString('hex');
        this.context.globalState.update('memox.authState', state);
        return state;
    }

    // Get stored state parameter
    public getStoredStateParam(): string | undefined {
        return this.context.globalState.get<string>('memox.authState');
    }

    // Check if user is authenticated
    public isAuthenticated(): boolean {
        const token = this.getAuthToken();
        return token !== undefined && token !== '';
    }

    // Get the current auth state
    public getState(): AuthState {
        return this.currentState;
    }

    // Update the authentication state
    private updateState(newState: AuthState): void {
        if (this.currentState !== newState) {
            this.currentState = newState;
            this._stateChanged.fire(newState);
        }
    }

    // Get GitHub client ID from settings or environment
    public getClientId(): string {
        const config = vscode.workspace.getConfiguration('memox');
        return config.get<string>('githubClientId') || process.env.GITHUB_CLIENT_ID || '';
    }

    // Get GitHub client secret from settings or environment
    private getClientSecret(): string {
        const config = vscode.workspace.getConfiguration('memox');
        return config.get<string>('githubClientSecret') || process.env.GITHUB_CLIENT_SECRET || '';
    }

    // Get stored auth token
    public getAuthToken(): string | undefined {
        // Try global state first, then fall back to workspace state
        const globalToken = this.context.globalState.get<string>('memox.authToken');
        const workspaceToken = this.context.workspaceState.get<string>('memox.authToken');
        
        console.log('MEmoX: Token retrieval - Global token exists:', !!globalToken, 'Workspace token exists:', !!workspaceToken);
        
        return globalToken || workspaceToken;
    }

    // Store auth token
    private setAuthToken(token: string): void {
        console.log('MEmoX: Storing auth token in both global and workspace state');
        this.context.globalState.update('memox.authToken', token);
        this.context.workspaceState.update('memox.authToken', token);
        
        // Ensure the token is persisted
        this.context.globalState.setKeysForSync(['memox.authToken']);
    }

    // Add token validation method
    private async validateToken(token: string): Promise<boolean> {
        try {
            console.log('MEmoX: Validating stored token');
            const response = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${token}`
                }
            });
            const isValid = response.status === 200;
            console.log('MEmoX: Token validation result:', isValid);
            return isValid;
        } catch (error) {
            console.error('MEmoX: Token validation failed:', error);
            return false;
        }
    }

    // Exchange GitHub code for access token
    public async exchangeGitHubCodeForToken(code: string, state: string, skipStateValidation: boolean = false): Promise<boolean> {
        try {
            // Verify state parameter matches what we stored, unless skipStateValidation is true
            if (!skipStateValidation) {
                const storedState = this.getStoredStateParam();
                console.log('MEmoX: Verifying state parameter. Stored state exists:', !!storedState);
                
                if (!storedState || storedState !== state) {
                    console.error('MEmoX: State parameter mismatch or missing');
                    vscode.window.showErrorMessage('MEmoX: Authentication failed. Invalid state parameter.');
                    this.updateState(AuthState.Error);
                    return false;
                }
            }

            this.updateState(AuthState.SigningIn);
            
            // GitHub OAuth token endpoint
            const url = 'https://github.com/login/oauth/access_token';
            const clientId = this.getClientId();
            const clientSecret = this.getClientSecret();
            
            console.log('MEmoX: Exchanging code for token. Have client ID:', !!clientId, 'Have client secret:', !!clientSecret);
            
            if (!clientId || !clientSecret) {
                console.error('MEmoX: Missing GitHub OAuth credentials');
                vscode.window.showErrorMessage('MEmoX: GitHub OAuth credentials are missing. Please check your configuration.');
                this.updateState(AuthState.Error);
                return false;
            }
            
            // Exchange code for token
            const response = await axios.post(url, {
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: 'vscode://memox/callback'
            }, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            console.log('MEmoX: Token exchange response received. Success:', !!response.data.access_token);

            if (response.data.access_token) {
                // Store the token securely
                this.setAuthToken(response.data.access_token);
                this.updateState(AuthState.SignedIn);
                vscode.window.showInformationMessage('MEmoX: Successfully signed in with GitHub!');
                return true;
            } else if (response.data.error) {
                console.error('MEmoX: GitHub API error:', response.data.error, response.data.error_description);
                vscode.window.showErrorMessage(`MEmoX: Authentication error: ${response.data.error_description || response.data.error}`);
                this.updateState(AuthState.Error);
                return false;
            } else {
                console.error('MEmoX: Failed to get access token, no error provided');
                vscode.window.showErrorMessage('MEmoX: Failed to get access token.');
                this.updateState(AuthState.Error);
                return false;
            }
        } catch (error) {
            console.error('MEmoX: Token exchange error:', error);
            vscode.window.showErrorMessage(`MEmoX: Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            this.updateState(AuthState.Error);
            return false;
        }
    }    // Set a direct token (for manual token entry)
    public async setDirectToken(token: string): Promise<boolean> {
        try {
            this.updateState(AuthState.SigningIn);
            
            // Validate the token with a GitHub API call
            const response = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${token}`
                }
            });
            
            if (response.status === 200) {
                this.setAuthToken(token);
                this.updateState(AuthState.SignedIn);
                vscode.window.showInformationMessage('MEmoX: Token validated and stored successfully!');
                return true;
            } else {
                vscode.window.showErrorMessage('MEmoX: Token validation failed.');
                this.updateState(AuthState.Error);
                return false;
            }
        } catch (error) {
            console.error('MEmoX: Token validation error:', error);
            vscode.window.showErrorMessage('MEmoX: Invalid token. Please check and try again.');
            this.updateState(AuthState.Error);
            return false;
        }
    }
    
    // Handle manual code entry (for when the automatic redirect fails)
    public async exchangeManualCode(code: string): Promise<boolean> {
        try {
            this.updateState(AuthState.SigningIn);
            
            // Generate a new state parameter since we don't have the original
            const state = this.generateStateParam();
            
            // Exchange the code for a token
            return await this.exchangeGitHubCodeForToken(code, state, true);
        } catch (error) {
            console.error('MEmoX: Manual code exchange error:', error);
            vscode.window.showErrorMessage('MEmoX: Failed to exchange authorization code. Please try again.');
            this.updateState(AuthState.Error);
            return false;
        }
    }

    // Sign out and clear token
    public signOut(): void {
        console.log('MEmoX: Signing out and clearing tokens from all storage locations');
        // Clear from both storage locations
        this.context.globalState.update('memox.authToken', undefined);
        this.context.workspaceState.update('memox.authToken', undefined);
        this.context.globalState.update('memox.authState', undefined);
        this.updateState(AuthState.SignedOut);
        vscode.window.showInformationMessage('MEmoX: Signed out successfully.');
    }
}
