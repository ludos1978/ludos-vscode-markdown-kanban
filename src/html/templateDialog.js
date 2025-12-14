/**
 * Template Dialog Handler
 * Handles template variable dialogs for collecting user input when applying templates
 */

/**
 * Show dialog to collect template variable values
 * @param {object} templateInfo - Contains templatePath, templateName, variables[], and position info
 */
function showTemplateVariableDialog(templateInfo) {
    // If no variables required, apply immediately
    if (!templateInfo.variables || templateInfo.variables.length === 0) {
        submitTemplateVariables(templateInfo, {});
        return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'template-dialog-overlay';
    overlay.id = 'template-variable-dialog-overlay';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'template-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'template-dialog-header';
    header.innerHTML = `
        <h3>Configure Template: ${escapeHtml(templateInfo.templateName || 'Template')}</h3>
        <button class="template-dialog-close" onclick="closeTemplateVariableDialog()">&times;</button>
    `;
    dialog.appendChild(header);

    // Form
    const form = document.createElement('form');
    form.className = 'template-dialog-form';
    form.id = 'template-variable-form';

    templateInfo.variables.forEach((variable, index) => {
        const field = document.createElement('div');
        field.className = 'template-dialog-field';

        const label = document.createElement('label');
        label.htmlFor = `template-var-${variable.name}`;
        label.textContent = variable.label || variable.name;
        if (variable.required !== false) {
            label.innerHTML += ' <span class="required">*</span>';
        }
        field.appendChild(label);

        const input = document.createElement('input');
        input.type = variable.type === 'number' ? 'number' : 'text';
        input.id = `template-var-${variable.name}`;
        input.name = variable.name;
        input.placeholder = variable.format ? `Format: ${variable.format}` : '';
        if (variable.default !== undefined) {
            input.value = variable.default;
        }
        if (variable.required !== false) {
            input.required = true;
        }
        if (index === 0) {
            input.autofocus = true;
        }
        field.appendChild(input);

        form.appendChild(field);
    });

    dialog.appendChild(form);

    // Footer with buttons
    const footer = document.createElement('div');
    footer.className = 'template-dialog-footer';
    footer.innerHTML = `
        <button type="button" class="template-dialog-btn template-dialog-cancel" onclick="closeTemplateVariableDialog()">Cancel</button>
        <button type="button" class="template-dialog-btn template-dialog-submit" onclick="submitTemplateVariablesFromForm()">Apply Template</button>
    `;
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Store template info for submission
    window._pendingTemplateInfo = templateInfo;

    // Focus first input
    setTimeout(() => {
        const firstInput = form.querySelector('input');
        if (firstInput) {
            firstInput.focus();
        }
    }, 50);

    // Handle form submission on Enter
    form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitTemplateVariablesFromForm();
        }
    });

    // Handle Escape to close
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTemplateVariableDialog();
        }
    });
}

/**
 * Close the template variable dialog
 */
function closeTemplateVariableDialog() {
    const overlay = document.getElementById('template-variable-dialog-overlay');
    if (overlay) {
        overlay.remove();
    }
    window._pendingTemplateInfo = null;
}

/**
 * Submit template variables from the form
 */
function submitTemplateVariablesFromForm() {
    const form = document.getElementById('template-variable-form');
    const templateInfo = window._pendingTemplateInfo;

    if (!form || !templateInfo) {
        return;
    }

    // Collect values
    const values = {};
    const formData = new FormData(form);
    for (const [name, value] of formData.entries()) {
        // Find variable definition to determine type
        const varDef = templateInfo.variables.find(v => v.name === name);
        if (varDef && varDef.type === 'number') {
            values[name] = parseFloat(value) || 0;
        } else {
            values[name] = value;
        }
    }

    // Validate required fields
    const missingFields = [];
    templateInfo.variables.forEach(variable => {
        if (variable.required !== false) {
            const value = values[variable.name];
            if (value === undefined || value === '' || (typeof value === 'number' && isNaN(value))) {
                missingFields.push(variable.label || variable.name);
            }
        }
    });

    if (missingFields.length > 0) {
        alert(`Please fill in required fields: ${missingFields.join(', ')}`);
        return;
    }

    submitTemplateVariables(templateInfo, values);
    closeTemplateVariableDialog();
}

/**
 * Send template variables to backend for application
 */
function submitTemplateVariables(templateInfo, values) {
    if (typeof vscode !== 'undefined') {
        vscode.postMessage({
            type: 'submitTemplateVariables',
            templatePath: templateInfo.templatePath,
            templateName: templateInfo.templateName,
            targetRow: templateInfo.targetRow,
            insertAfterColumnId: templateInfo.insertAfterColumnId,
            insertBeforeColumnId: templateInfo.insertBeforeColumnId,
            position: templateInfo.position,
            variables: values
        });
    }
}

// Export functions to window for use by other modules and onclick handlers
window.showTemplateVariableDialog = showTemplateVariableDialog;
window.closeTemplateVariableDialog = closeTemplateVariableDialog;
window.submitTemplateVariablesFromForm = submitTemplateVariablesFromForm;
window.submitTemplateVariables = submitTemplateVariables;
