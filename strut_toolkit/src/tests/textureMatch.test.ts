import { matchTextures } from '../ts/stage/textureMatch';

const file = (name: string): { name: string; content: string } => ({ name, content: `data:${name}` });

describe('which image is which texture', () => {
    test('by name, with the extension and any path left off either side', () => {
        const match = matchTextures(['jenny', 'textures/entities/jenny_body.png'], [file('C:/packs/jenny_body.PNG'), file('Jenny.png')]);

        expect(match.images.get('jenny')).toBe('data:Jenny.png');
        expect(match.images.get('textures/entities/jenny_body.png')).toBe('data:C:/packs/jenny_body.PNG');
        expect(match.missing).toEqual([]);
        expect(match.unused).toEqual([]);
    });

    test('a model with one texture takes the one image it is given, whatever it is called', () => {
        const match = matchTextures(['skin'], [file('whatever.png')]);

        expect(match.images.get('skin')).toBe('data:whatever.png');
    });

    test('with several textures nothing is guessed: what has no image is missing, what no texture wants is unused', () => {
        const match = matchTextures(['body', 'hair'], [file('body.png'), file('eyes.png')]);

        expect(match.images.get('body')).toBe('data:body.png');
        expect(match.missing).toEqual(['hair']);
        expect(match.unused).toEqual(['eyes.png']);
    });

    test('an image is given to one texture only', () => {
        const match = matchTextures(['x/a', 'y/a'], [file('a.png')]);

        expect(match.missing).toHaveLength(1);
    });

    test('no images: everything is missing', () => {
        expect(matchTextures(['a', 'b'], []).missing).toEqual(['a', 'b']);
    });
});
