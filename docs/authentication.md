## Authentication

MEmoX offers a secure authentication system with two methods for user convenience:

### GitHub OAuth Authentication

1. Click on the "MEmoX: Sign In" button in the VS Code status bar
2. Select "Sign in with GitHub" in the authentication window
3. Your default browser will open with GitHub's authorization page
4. Approve the requested permissions
5. VS Code will automatically receive the authentication token
6. The status bar will update to show "MEmoX: Signed In"

### Personal Access Token Authentication

If you prefer to use a Personal Access Token (PAT) instead:

1. Create a GitHub Personal Access Token with the `user:email` scope
   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Generate a new token with the "user:email" scope
2. Click on the "MEmoX: Sign In" button in the VS Code status bar
3. Select "Enter GitHub Token"
4. Paste your Personal Access Token
5. The status bar will update once the token is validated

### Configuration for OAuth Integration

For organizations using this extension, you'll need to register an OAuth application with GitHub:

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set the Application name to "MEmoX"
3. Set the Homepage URL to your organization's URL
4. Set the Authorization callback URL to `vscode://MEmoX/callback`
5. Register the application and note the Client ID and Client Secret
6. Configure these values in VS Code settings:
   - `MEmoX.githubClientId`: Your GitHub OAuth Client ID
   - `MEmoX.githubClientSecret`: Your GitHub OAuth Client Secret

### Security Notes

- All authentication tokens are stored securely in VS Code's secure storage
- Token validation occurs without exposing credentials in transit
- Sign out anytime by clicking "MEmoX: Signed In" in the status bar
