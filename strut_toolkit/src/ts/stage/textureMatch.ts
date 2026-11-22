/**
 * Which image is the texture of which model texture: by name first (the file {@code eve.png} for the model's texture {@code eve}, with a path or the extension
 * left off either way), and a model with one texture given one image takes it whatever it is called. What is left over is reported, never guessed
 */

export interface ImageFile {
    readonly name: string;
    /** The image as a data URL */
    readonly content: string;
}

export interface TextureMatch {
    /** By the model texture's name */
    readonly images: ReadonlyMap<string, string>;
    /** Model textures that got no image: they are drawn as the placeholder */
    readonly missing: readonly string[];
    /** Images that no texture of the model asked for */
    readonly unused: readonly string[];
}

/** The last part of a path, lower case, with the extension cut off */
function stem(name: string): string {
    const last = name.split('\\').join('/').split('/').pop() ?? name;
    const dot = last.lastIndexOf('.');

    return (dot > 0 ? last.slice(0, dot) : last).toLowerCase();
}

export function matchTextures(textureNames: readonly string[], files: readonly ImageFile[]): TextureMatch {
    const images = new Map<string, string>();
    const taken = new Set<ImageFile>();

    for (const texture of textureNames) {
        const wanted = stem(texture);
        const found = files.find(file => !taken.has(file) && stem(file.name) === wanted);

        if (found) {
            images.set(texture, found.content);
            taken.add(found);
        }
    }

    // one texture and one image: that image is it
    const left = textureNames.filter(texture => !images.has(texture));
    const spare = files.filter(file => !taken.has(file));

    if (left.length === 1 && spare.length === 1 && textureNames.length === 1) {
        images.set(left[0], spare[0].content);
        taken.add(spare[0]);
    }

    return {
        images,
        missing: textureNames.filter(texture => !images.has(texture)),
        unused: files.filter(file => !taken.has(file)).map(file => file.name),
    };
}
