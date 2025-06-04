# Setting Up GitHub OAuth for MEmoX

This guide will help you configure GitHub OAuth for MEmoX.

## 1. Create a GitHub OAuth Application

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click on "New OAuth App" or select an existing app to modify
3. Fill in the application details:
   - **Application name**: MEmoX
   - **Homepage URL**: Your organization website or https://github.com/MemoraNet/MEmoX
   - **Application description**: (Optional) AI-powered coding assistant for VS Code
   - **Authorization callback URL**: `vscode://memox/callback`
4. Click "Register application"
5. Note your Client ID
6. Generate a new Client Secret and make note of it (you won't be able to see it again)

![GitHub OAuth App Registration](https://docs.github.com/assets/cb-34573/mw-1440/images/help/apps/oauth-app-creation-form.webp)

## 2. Configure MEmoX Extension

### Option A: Using Environment Variables (Recommended for Development)

1. Create a `.env` file in the extension's root directory (based on `.env.example`)
2. Add your GitHub OAuth credentials:
   ```
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   ```
3. Restart VS Code

> **Security Note:** The `.env` file is automatically excluded from Git via `.gitignore` to prevent accidentally committing sensitive credentials.

### Option B: Using VS Code Settings (For End Users)

1. Open VS Code Settings (File > Preferences > Settings)
2. Search for "MEmoX"
3. Enter your GitHub OAuth credentials:
   - `memox.githubClientId`: Your GitHub Client ID
   - `memox.githubClientSecret`: Your GitHub Client Secret
4. Restart VS Code

## 3. Testing the OAuth Flow

1. Click on the "Sign In" button in the MEmoX panel
2. Select "Sign in with GitHub"
3. You should be redirected to GitHub for authorization
4. After approval, VS Code should receive the callback and sign you in automatically

## Troubleshooting

- **Callback URL Error**: Ensure the callback URL is exactly `vscode://memox/callback`
- **Authentication Failed**: Verify your Client ID and Secret are correctly configured
- **VS Code Not Responding to Callback**: Ensure the extension is activated by opening the MEmoX chat panel
- **Manual Code Entry**: If the automatic callback fails, you can use the "Enter Code Manually" option in MEmoX

For more detailed information, refer to the [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
