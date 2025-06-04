# MEmoX Authentication Implementation

## Overview

MEmoX implements a secure, user-friendly authentication flow using GitHub OAuth, with an alternative direct token entry method. This document explains the implementation details, best practices used, and security considerations.

## Architecture

The authentication system consists of several key components:

1. **AuthService** - Core authentication logic
2. **AuthWebview** - Authentication UI and GitHub OAuth redirect handling
3. **SignInButton** - Status bar entry point for authentication
4. **Integration with ChatPanel** - Auth-aware chat interface

## Authentication Methods

### GitHub OAuth Flow

1. User clicks the "MEmoX: Sign In" button in the VS Code status bar
2. The AuthWebview displays authentication options
3. When "Sign in with GitHub" is selected:
   - A secure state parameter is generated and stored
   - GitHub OAuth URL is constructed with client ID and redirect URI
   - The system browser opens with the GitHub authorization page
4. User approves access permissions on GitHub
5. GitHub redirects to `vscode://MEmoX/callback?code=xxx&state=yyy`
6. VS Code intercepts this URI via the registered URI handler
7. The auth code and state parameter are validated
8. The code is exchanged for an access token
9. The token is securely stored in VS Code's global state
10. UI is updated to reflect signed-in status
11. Chat interface becomes available

### Direct Token Entry Flow

1. User clicks the "MEmoX: Sign In" button in the status bar
2. The AuthWebview displays authentication options
3. When "Enter GitHub Token" is selected:
   - User is prompted for their personal access token
   - The token is validated with a GitHub API call
   - Upon successful validation, token is stored securely
   - UI is updated to reflect signed-in status

## Security Considerations

- **State Parameter**: Prevents CSRF attacks during OAuth flow
- **Secure Token Storage**: Tokens stored in VS Code's secure global state
- **Client Secret Protection**: Can be stored in .env file (not committed to Git) or VS Code settings
- **Token Validation**: All tokens are validated before being accepted
- **Clear Sign-out**: Simple way to revoke access and clear tokens

## User Experience

- **Status Bar Indicator**: Shows authentication state at a glance
- **Contextual Prompts**: Chat interface prompts for authentication when needed
- **Seamless Flow**: Automatic UI updates after authentication
- **Helpful Messages**: Clear guidance throughout the authentication process

## Configuration

Organizations deploying MEmoX should:

1. Register a GitHub OAuth application
2. Configure client ID and secret in:
   - `.env` file (development)
   - VS Code settings (end users)
3. Ensure the callback URL is exactly `vscode://MEmoX/callback`

## Best Practices Implemented

- **Error Handling**: Comprehensive error states and user messages
- **Async Operations**: Non-blocking authentication processes
- **State Management**: Clear state transitions and event-based updates
- **Separation of Concerns**: Auth logic separate from UI components
- **Secure Defaults**: Auth required for all operations by default

## Extensibility

The authentication system is designed to be extensible:

- Additional auth providers could be added
- Token refresh mechanism could be implemented
- Scoped access could be implemented for different features

This implementation provides a robust foundation for secure user authentication in the MEmoX extension.
