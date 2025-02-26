"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const WebSocket = require("ws");
const crypto = require("crypto");
// Global state
let socket = null;
let statusBarItem = null;
let currentUser = null;
const fileDecorations = new Map();
const usersByFile = new Map();
function activate(context) {
    console.log('Git Presence extension activated');
    // Create status bar item to show connection status
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(plug) Git Presence: Disconnected";
    statusBarItem.command = "git-presence.connect";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('git-presence.connect', () => {
        connectToServer(context);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('git-presence.disconnect', () => {
        disconnectFromServer();
    }));
    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('gitPresence');
    if (config.get('autoConnect', true)) {
        connectToServer(context);
    }
    // Track file focus events
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!socket || !editor || !currentUser)
            return;
        // Only track files in a workspace
        const filePath = editor.document.uri.path;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (workspaceFolder) {
            const relativePath = filePath.replace(workspaceFolder.uri.path, '');
            const repoId = workspaceFolder.uri.toString();
            const message = {
                type: 'FileFocus',
                data: {
                    file_path: relativePath,
                    repo_id: repoId
                }
            };
            socket.send(JSON.stringify(message));
        }
    }));
}
exports.activate = activate;
function connectToServer(context) {
    if (socket) {
        vscode.window.showInformationMessage('Already connected to Git Presence server');
        return;
    }
    const config = vscode.workspace.getConfiguration('gitPresence');
    const serverUrl = config.get('serverUrl', 'ws://localhost:3030');
    try {
        socket = new WebSocket(serverUrl);
        socket.onopen = () => {
            if (statusBarItem) {
                statusBarItem.text = "$(check) Git Presence: Connected";
                statusBarItem.command = "git-presence.disconnect";
            }
            vscode.window.showInformationMessage('Connected to Git Presence server');
            registerUser(context);
        };
        socket.onmessage = (event) => {
            handleServerMessage(event.data.toString());
        };
        socket.onclose = () => {
            if (statusBarItem) {
                statusBarItem.text = "$(plug) Git Presence: Disconnected";
                statusBarItem.command = "git-presence.connect";
            }
            vscode.window.showWarningMessage('Disconnected from Git Presence server');
            socket = null;
        };
        socket.onerror = (error) => {
            vscode.window.showErrorMessage(`Git Presence error: ${error.message}`);
            disconnectFromServer();
        };
    }
    catch (error) {
        vscode.window.showErrorMessage(`Failed to connect to Git Presence server: ${error}`);
        socket = null;
    }
}
function disconnectFromServer() {
    if (!socket)
        return;
    socket.close();
    socket = null;
    // Clear all decorations
    for (const decoration of fileDecorations.values()) {
        decoration.dispose();
    }
    fileDecorations.clear();
    usersByFile.clear();
    if (statusBarItem) {
        statusBarItem.text = "$(plug) Git Presence: Disconnected";
        statusBarItem.command = "git-presence.connect";
    }
}
function registerUser(context) {
    if (!socket)
        return;
    // Get user info from Git config
    const gitConfig = vscode.workspace.getConfiguration('git');
    const userName = gitConfig.get('user.name') || 'Anonymous';
    currentUser = {
        user_id: generateUserId(context),
        name: userName,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}`,
        current_file: null
    };
    const message = {
        type: 'Register',
        data: currentUser
    };
    socket.send(JSON.stringify(message));
}
function generateUserId(context) {
    const storedId = context.globalState.get('userId');
    if (storedId)
        return storedId;
    const newId = crypto.randomUUID();
    context.globalState.update('userId', newId);
    return newId;
}
function handleServerMessage(data) {
    try {
        const message = JSON.parse(data);
        switch (message.type) {
            case 'UsersUpdate':
                // Update our internal view of users
                // Could be used to show a panel of active users
                break;
            case 'FileActivityUpdate':
                updateFileDecorations(message.data);
                break;
        }
    }
    catch (error) {
        console.error('Failed to parse server message:', error);
    }
}
function updateFileDecorations(activity) {
    // Skip our own activity
    if (currentUser && activity.user_id === currentUser.user_id)
        return;
    // Update users editing this file
    let users = usersByFile.get(activity.file_path) || new Set();
    users.add(activity.user_id);
    usersByFile.set(activity.file_path, users);
    // Create or update file decoration
    if (!fileDecorations.has(activity.file_path)) {
        const decoration = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        fileDecorations.set(activity.file_path, decoration);
    }
    const decoration = fileDecorations.get(activity.file_path);
    decoration.text = `$(person) ${users.size} user${users.size > 1 ? 's' : ''} editing ${activity.file_path}`;
    decoration.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    decoration.show();
    // Show notification if enabled
    const config = vscode.workspace.getConfiguration('gitPresence');
    if (config.get('showNotifications', true)) {
        vscode.window.showInformationMessage(`Other users are editing ${activity.file_path}`);
    }
    // Clear decoration after some time
    setTimeout(() => {
        const decoration = fileDecorations.get(activity.file_path);
        if (decoration) {
            decoration.dispose();
            fileDecorations.delete(activity.file_path);
        }
        usersByFile.delete(activity.file_path);
    }, 30300); // 30 seconds
}
function deactivate() {
    disconnectFromServer();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extenstion.js.map