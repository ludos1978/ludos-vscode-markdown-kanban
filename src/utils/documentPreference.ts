import * as vscode from 'vscode';

const DOCUMENT_PREFERENCE_PREFIX = 'kanban_doc_pref';

function normalizeDocumentUri(uri: string): string {
    return Buffer.from(uri).toString('base64').replace(/[^a-zA-Z0-9]/g, '_');
}

export function buildDocumentPreferenceKey(documentUri: string, preferenceKey: string): string {
    const normalizedUri = normalizeDocumentUri(documentUri);
    const normalizedKey = preferenceKey.replace(/\s+/g, '_');
    return `${DOCUMENT_PREFERENCE_PREFIX}_${normalizedUri}_${normalizedKey}`;
}

export function getDocumentPreference(
    extensionContext: vscode.ExtensionContext,
    documentUri: string,
    preferenceKey: string
): unknown {
    const storageKey = buildDocumentPreferenceKey(documentUri, preferenceKey);
    return extensionContext.globalState.get(storageKey);
}

export function setDocumentPreference(
    extensionContext: vscode.ExtensionContext,
    documentUri: string,
    preferenceKey: string,
    value: unknown
): Thenable<void> {
    const storageKey = buildDocumentPreferenceKey(documentUri, preferenceKey);
    return extensionContext.globalState.update(storageKey, value);
}
