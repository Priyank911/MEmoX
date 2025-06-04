import * as vscode from 'vscode';
import { AuthService, AuthState } from './AuthService';
import { AuthWebview } from './AuthWebview';

export class SignInButton {
    private static instance: SignInButton;
    private statusBarItem: vscode.StatusBarItem;
    private authService: AuthService;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext, authService: AuthService) {
        this.context = context;
        this.authService = authService;
          // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'memox.signIn';
        
        // Update the button state based on current auth state
        this.updateButtonState();
        this.statusBarItem.show();
        
        // Subscribe to auth state changes
        this.authService.onStateChanged(this.handleAuthStateChanged.bind(this));
    }

    // Get or create instance (singleton pattern)
    public static getInstance(context: vscode.ExtensionContext, authService: AuthService): SignInButton {
        if (!SignInButton.instance) {
            SignInButton.instance = new SignInButton(context, authService);
        }
        return SignInButton.instance;
    }

    // Handle auth state changes
    private handleAuthStateChanged(state: AuthState): void {
        this.updateButtonState();
    }

    // Update the button appearance based on auth state
    public updateButtonState(): void {
        const state = this.authService.getState();
        
        switch (state) {            case AuthState.SignedIn:
                this.statusBarItem.text = '$(check) MEmoX: Signed In';
                this.statusBarItem.tooltip = 'Signed in to MEmoX. Click to sign out.';
                this.statusBarItem.command = 'memox.signOut';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                break;
                
            case AuthState.SigningIn:
                this.statusBarItem.text = '$(sync~spin) MEmoX: Signing In...';
                this.statusBarItem.tooltip = 'Signing in to MEmoX...';
                this.statusBarItem.command = undefined;
                this.statusBarItem.backgroundColor = undefined;
                break;
                
            case AuthState.Error:
                this.statusBarItem.text = '$(error) MEmoX: Auth Error';
                this.statusBarItem.tooltip = 'Authentication error. Click to try again.';
                this.statusBarItem.command = 'memox.signIn';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
                
            case AuthState.SignedOut:
            default:
                this.statusBarItem.text = '$(key) MEmoX: Sign In';
                this.statusBarItem.tooltip = 'Sign in to MEmoX';
                this.statusBarItem.command = 'memox.signIn';
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }

    // Initiate sign in process
    public signIn(): void {
        const authWebview = new AuthWebview(this.context, this.authService);
        authWebview.show();
    }

    // Sign out
    public signOut(): void {
        this.authService.signOut();
    }
}
