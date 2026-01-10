import { WysiwygSchemaSpec, WysiwygNodeSpec, WysiwygMarkSpec, wysiwygSchemaSpec } from './spec';

export type NormalizedWysiwygSchemaSpec = {
    nodes: Record<string, WysiwygNodeSpec>;
    marks: Record<string, WysiwygMarkSpec>;
};

function cloneNodeSpec(name: string, spec: WysiwygNodeSpec): WysiwygNodeSpec {
    const cloned: WysiwygNodeSpec = { ...spec };

    if (name === 'text') {
        cloned.inline = true;
        cloned.group = cloned.group ?? 'inline';
    }

    if (spec.inline && !spec.group) {
        cloned.group = 'inline';
    }

    if (name === 'doc' && !spec.content) {
        cloned.content = 'block+';
    }

    return cloned;
}

function cloneMarkSpec(spec: WysiwygMarkSpec): WysiwygMarkSpec {
    return { ...spec };
}

export function buildWysiwygSchemaSpec(source: WysiwygSchemaSpec = wysiwygSchemaSpec): NormalizedWysiwygSchemaSpec {
    const nodes: Record<string, WysiwygNodeSpec> = {};
    const marks: Record<string, WysiwygMarkSpec> = {};

    for (const [name, spec] of Object.entries(source.nodes)) {
        nodes[name] = cloneNodeSpec(name, spec);
    }

    for (const [name, spec] of Object.entries(source.marks)) {
        marks[name] = cloneMarkSpec(spec);
    }

    return { nodes, marks };
}
