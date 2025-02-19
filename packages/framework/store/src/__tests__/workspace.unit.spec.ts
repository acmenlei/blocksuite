/* eslint-disable @typescript-eslint/no-restricted-imports */
// checkout https://vitest.dev/guide/debugging.html for debugging tests

import type { Slot } from '@blocksuite/global/utils';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';

import { PAGE_VERSION, WORKSPACE_VERSION } from '../consts.js';
import type { BlockModel, BlockSchemaType, Doc } from '../index.js';
import { Generator, Schema, Workspace } from '../index.js';
import type { DocMeta } from '../workspace/index.js';
import type { BlockSuiteDoc } from '../yjs/index.js';
import {
  NoteBlockSchema,
  ParagraphBlockSchema,
  RootBlockSchema,
} from './test-schema.js';
import { assertExists } from './test-utils-dom.js';

export const BlockSchemas = [
  ParagraphBlockSchema,
  RootBlockSchema,
  NoteBlockSchema,
] as BlockSchemaType[];

function createTestOptions() {
  const idGenerator = Generator.AutoIncrement;
  const schema = new Schema();
  schema.register(BlockSchemas);
  return { id: 'test-workspace', idGenerator, schema };
}

const defaultDocId = 'doc:home';
const spaceId = defaultDocId;
const spaceMetaId = 'meta';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeWorkspace(doc: BlockSuiteDoc): Record<string, any> {
  const spaces = {};
  doc.spaces.forEach((subDoc, key) => {
    // @ts-ignore
    spaces[key] = subDoc.toJSON();
  });
  const json = doc.toJSON();
  delete json.spaces;

  return {
    ...json,
    spaces,
  };
}

function waitOnce<T>(slot: Slot<T>) {
  return new Promise<T>(resolve => slot.once(val => resolve(val)));
}

function createRoot(doc: Doc) {
  doc.addBlock('affine:page');
  if (!doc.root) throw new Error('root not found');
  return doc.root;
}

function createTestDoc(docId = defaultDocId) {
  const options = createTestOptions();
  const workspace = new Workspace(options);
  const doc = workspace.createDoc({ id: docId });
  doc.load();
  return doc;
}

function requestIdleCallbackPolyfill(
  callback: IdleRequestCallback,
  options?: IdleRequestOptions
) {
  const timeout = options?.timeout ?? 1000;
  const start = Date.now();
  return setTimeout(function () {
    callback({
      didTimeout: false,
      timeRemaining: function () {
        return Math.max(0, timeout - (Date.now() - start));
      },
    });
  }, timeout) as unknown as number;
}

beforeEach(() => {
  if (globalThis.requestIdleCallback === undefined) {
    globalThis.requestIdleCallback = requestIdleCallbackPolyfill;
  }
});

describe('basic', () => {
  it('can init workspace', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    assert.equal(workspace.isEmpty, true);

    const doc = workspace.createDoc({ id: 'doc:home' });
    doc.load();
    const actual = serializeWorkspace(workspace.doc);
    const actualDoc = actual[spaceMetaId].pages[0] as DocMeta;

    assert.equal(workspace.isEmpty, false);
    assert.equal(typeof actualDoc.createDate, 'number');
    // @ts-ignore
    delete actualDoc.createDate;

    assert.deepEqual(actual, {
      [spaceMetaId]: {
        pages: [
          {
            id: 'doc:home',
            title: '',
            tags: [],
          },
        ],
        workspaceVersion: WORKSPACE_VERSION,
        pageVersion: PAGE_VERSION,
        blockVersions: {
          'affine:note': 1,
          'affine:page': 2,
          'affine:paragraph': 1,
        },
      },
      spaces: {
        [spaceId]: {
          blocks: {},
        },
      },
    });
  });

  it('init workspace with custom id generator', () => {
    const options = createTestOptions();
    let id = 100;
    const workspace = new Workspace({
      ...options,
      idGenerator: () => {
        return String(id++);
      },
    });
    {
      const doc = workspace.createDoc();
      assert.equal(doc.id, '100');
    }
    {
      const doc = workspace.createDoc();
      assert.equal(doc.id, '101');
    }
  });

  it('doc ready lifecycle', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    const doc = workspace.createDoc({
      id: 'space:0',
    });

    const readyCallback = vi.fn();
    const rootAddedCallback = vi.fn();
    doc.slots.ready.on(readyCallback);
    doc.slots.rootAdded.on(rootAddedCallback);

    doc.load(() => {
      expect(doc.ready).toBe(false);
      const rootId = doc.addBlock('affine:page', {
        title: new doc.Text(),
      });
      expect(rootAddedCallback).toBeCalledTimes(1);
      expect(doc.ready).toBe(false);

      doc.addBlock('affine:note', {}, rootId);
    });

    expect(doc.ready).toBe(true);
    expect(readyCallback).toBeCalledTimes(1);
  });

  it('workspace docs with yjs applyUpdate', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    const workspace2 = new Workspace(options);
    const doc = workspace.createDoc({
      id: 'space:0',
    });
    doc.load(() => {
      doc.addBlock('affine:page', {
        title: new doc.Text(),
      });
    });
    {
      const subdocsTester = vi.fn(({ added }) => {
        expect(added.size).toBe(1);
      });
      // only apply root update
      workspace2.doc.once('subdocs', subdocsTester);
      expect(subdocsTester).toBeCalledTimes(0);
      expect(workspace2.docs.size).toBe(0);
      const update = encodeStateAsUpdate(workspace.doc);
      applyUpdate(workspace2.doc, update);
      expect(workspace2.doc.toJSON()['spaces']).toEqual({
        'space:0': {
          blocks: {},
        },
      });
      expect(workspace2.docs.size).toBe(1);
      expect(subdocsTester).toBeCalledTimes(1);
    }
    {
      // apply doc update
      const update = encodeStateAsUpdate(doc.spaceDoc);
      expect(workspace2.docs.size).toBe(1);
      const doc2 = workspace2.getDoc('space:0');
      assertExists(doc2);
      applyUpdate(doc2.spaceDoc, update);
      expect(workspace2.doc.toJSON()['spaces']).toEqual({
        'space:0': {
          blocks: {
            '0': {
              'prop:title': '',
              'sys:children': [],
              'sys:flavour': 'affine:page',
              'sys:id': '0',
              'sys:version': 2,
            },
          },
        },
      });
      const fn = vi.fn(({ loaded }) => {
        expect(loaded.size).toBe(1);
      });
      workspace2.doc.once('subdocs', fn);
      expect(fn).toBeCalledTimes(0);
      doc2.load();
      expect(fn).toBeCalledTimes(1);
    }
  });
});

describe('addBlock', () => {
  it('can add single model', () => {
    const doc = createTestDoc();
    doc.addBlock('affine:page', {
      title: new doc.Text(),
    });

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': [],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
    });
  });

  it('can add model with props', () => {
    const doc = createTestDoc();
    doc.addBlock('affine:page', { title: new doc.Text('hello') });

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'sys:children': [],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'prop:title': 'hello',
        'sys:version': 2,
      },
    });
  });

  it('can add multi models', () => {
    const doc = createTestDoc();
    const rootId = doc.addBlock('affine:page', {
      title: new doc.Text(),
    });
    const noteId = doc.addBlock('affine:note', {}, rootId);
    doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlocks(
      [
        { flavour: 'affine:paragraph', blockProps: { type: 'h1' } },
        { flavour: 'affine:paragraph', blockProps: { type: 'h2' } },
      ],
      noteId
    );

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'prop:title': '',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['2', '3', '4'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '2': {
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '2',
        'prop:text': '',
        'prop:type': 'text',
        'sys:version': 1,
      },
      '3': {
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'prop:text': '',
        'prop:type': 'h1',
        'sys:version': 1,
      },
      '4': {
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '4',
        'prop:text': '',
        'prop:type': 'h2',
        'sys:version': 1,
      },
    });
  });

  it('can observe slot events', async () => {
    const doc = createTestDoc();

    queueMicrotask(() =>
      doc.addBlock('affine:page', {
        title: new doc.Text(),
      })
    );
    const block = await waitOnce(doc.slots.rootAdded);
    assert.equal(block.flavour, 'affine:page');
  });

  it('can add block to root', async () => {
    const doc = createTestDoc();

    let noteId: string;

    queueMicrotask(() => {
      const rootId = doc.addBlock('affine:page');
      noteId = doc.addBlock('affine:note', {}, rootId);
    });
    await waitOnce(doc.slots.rootAdded);
    const { root } = doc;
    if (!root) throw new Error('root is null');

    assert.equal(root.flavour, 'affine:page');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    doc.addBlock('affine:paragraph', {}, noteId!);
    assert.equal(root.children[0].flavour, 'affine:note');
    assert.equal(root.children[0].children[0].flavour, 'affine:paragraph');
    assert.equal(root.childMap.get('1'), 0);

    const serializedChildren = serializeWorkspace(doc.rootDoc).spaces[spaceId]
      .blocks['0']['sys:children'];
    assert.deepEqual(serializedChildren, ['1']);
    assert.equal(root.children[0].id, '1');
  });

  it('can add and remove multi docs', async () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);

    const doc0 = workspace.createDoc({ id: 'doc:home' });
    const doc1 = workspace.createDoc({ id: 'space:doc1' });
    await Promise.all([doc0.load(), doc1.load()]);
    assert.equal(workspace.docs.size, 2);

    doc0.addBlock('affine:page', {
      title: new doc0.Text(),
    });
    workspace.removeDoc(doc0.id);

    assert.equal(workspace.docs.size, 1);
    assert.equal(
      serializeWorkspace(doc0.rootDoc).spaces['doc:home'],
      undefined
    );

    workspace.removeDoc(doc1.id);
    assert.equal(workspace.docs.size, 0);
  });

  it('can remove doc that has not been loaded', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);

    const doc0 = workspace.createDoc({ id: 'doc:home' });

    workspace.removeDoc(doc0.id);
    assert.equal(workspace.docs.size, 0);
  });

  it('can set doc state', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    workspace.createDoc({ id: 'doc:home' });

    assert.deepEqual(
      workspace.meta.docMetas.map(({ id, title }) => ({
        id,
        title,
      })),
      [
        {
          id: 'doc:home',
          title: '',
        },
      ]
    );

    let called = false;
    workspace.meta.docMetaUpdated.on(() => {
      called = true;
    });

    // @ts-ignore
    workspace.setDocMeta('doc:home', { favorite: true });
    assert.deepEqual(
      // @ts-ignore
      workspace.meta.docMetas.map(({ id, title, favorite }) => ({
        id,
        title,
        favorite,
      })),
      [
        {
          id: 'doc:home',
          title: '',
          favorite: true,
        },
      ]
    );
    assert.ok(called);
  });

  it('can set workspace common meta fields', async () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);

    queueMicrotask(() => workspace.meta.setName('hello'));
    await waitOnce(workspace.meta.commonFieldsUpdated);
    assert.deepEqual(workspace.meta.name, 'hello');

    queueMicrotask(() => workspace.meta.setAvatar('gengar.jpg'));
    await waitOnce(workspace.meta.commonFieldsUpdated);
    assert.deepEqual(workspace.meta.avatar, 'gengar.jpg');
  });
});

describe('deleteBlock', () => {
  it('delete children recursively by default', () => {
    const doc = createTestDoc();

    const rootId = doc.addBlock('affine:page', {});
    const noteId = doc.addBlock('affine:note', {}, rootId);
    doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, noteId);
    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['2', '3'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '2': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '2',
        'sys:version': 1,
      },
      '3': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'sys:version': 1,
      },
    });

    const deletedModel = doc.getBlockById('1') as BlockModel;
    doc.deleteBlock(deletedModel);

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': [],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
    });
  });

  it('bring children to parent', () => {
    const doc = createTestDoc();

    const rootId = doc.addBlock('affine:page', {});
    const noteId = doc.addBlock('affine:note', {}, rootId);
    const p1 = doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, p1);
    doc.addBlock('affine:paragraph', {}, p1);

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['2'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '2': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': ['3', '4'],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '2',
        'sys:version': 1,
      },
      '3': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'sys:version': 1,
      },
      '4': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '4',
        'sys:version': 1,
      },
    });

    const deletedModel = doc.getBlockById('2') as BlockModel;
    const deletedModelParent = doc.getBlockById('1') as BlockModel;
    doc.deleteBlock(deletedModel, {
      bringChildrenTo: deletedModelParent,
    });

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['3', '4'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '3': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'sys:version': 1,
      },
      '4': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '4',
        'sys:version': 1,
      },
    });
  });

  it('bring children to other block', () => {
    const doc = createTestDoc();

    const rootId = doc.addBlock('affine:page', {});
    const noteId = doc.addBlock('affine:note', {}, rootId);
    const p1 = doc.addBlock('affine:paragraph', {}, noteId);
    const p2 = doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, p1);
    doc.addBlock('affine:paragraph', {}, p1);
    doc.addBlock('affine:paragraph', {}, p2);

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['2', '3'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '2': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': ['4', '5'],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '2',
        'sys:version': 1,
      },
      '3': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': ['6'],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'sys:version': 1,
      },
      '4': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '4',
        'sys:version': 1,
      },
      '5': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '5',
        'sys:version': 1,
      },
      '6': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '6',
        'sys:version': 1,
      },
    });

    const deletedModel = doc.getBlockById('2') as BlockModel;
    const moveToModel = doc.getBlockById('3') as BlockModel;
    doc.deleteBlock(deletedModel, {
      bringChildrenTo: moveToModel,
    });

    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['3'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '3': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': ['6', '4', '5'],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '3',
        'sys:version': 1,
      },
      '4': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '4',
        'sys:version': 1,
      },
      '5': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '5',
        'sys:version': 1,
      },
      '6': {
        'prop:text': '',
        'prop:type': 'text',
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '6',
        'sys:version': 1,
      },
    });
  });

  it('can delete model with parent', () => {
    const doc = createTestDoc();
    const rootModel = createRoot(doc);
    const noteId = doc.addBlock('affine:note', {}, rootModel.id);

    doc.addBlock('affine:paragraph', {}, noteId);

    // before delete
    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': ['2'],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
      '2': {
        'sys:children': [],
        'sys:flavour': 'affine:paragraph',
        'sys:id': '2',
        'prop:text': '',
        'prop:type': 'text',
        'sys:version': 1,
      },
    });

    doc.deleteBlock(rootModel.children[0].children[0]);

    // after delete
    assert.deepEqual(serializeWorkspace(doc.rootDoc).spaces[spaceId].blocks, {
      '0': {
        'prop:title': '',
        'sys:children': ['1'],
        'sys:flavour': 'affine:page',
        'sys:id': '0',
        'sys:version': 2,
      },
      '1': {
        'sys:children': [],
        'sys:flavour': 'affine:note',
        'sys:id': '1',
        'sys:version': 1,
      },
    });
    assert.equal(rootModel.children.length, 1);
  });
});

describe('getBlock', () => {
  it('can get block by id', () => {
    const doc = createTestDoc();
    const rootModel = createRoot(doc);
    const noteId = doc.addBlock('affine:note', {}, rootModel.id);

    doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, noteId);

    const text = doc.getBlockById('3') as BlockModel;
    assert.equal(text.flavour, 'affine:paragraph');
    assert.equal(rootModel.children[0].children.indexOf(text), 1);

    const invalid = doc.getBlockById('😅');
    assert.equal(invalid, null);
  });

  it('can get parent', () => {
    const doc = createTestDoc();
    const rootModel = createRoot(doc);
    const noteId = doc.addBlock('affine:note', {}, rootModel.id);

    doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, noteId);

    const result = doc.getParent(
      rootModel.children[0].children[1]
    ) as BlockModel;
    assert.equal(result, rootModel.children[0]);

    const invalid = doc.getParent(rootModel);
    assert.equal(invalid, null);
  });

  it('can get previous sibling', () => {
    const doc = createTestDoc();
    const rootModel = createRoot(doc);
    const noteId = doc.addBlock('affine:note', {}, rootModel.id);

    doc.addBlock('affine:paragraph', {}, noteId);
    doc.addBlock('affine:paragraph', {}, noteId);

    const result = doc.getPreviousSibling(
      rootModel.children[0].children[1]
    ) as BlockModel;
    assert.equal(result, rootModel.children[0].children[0]);

    const invalid = doc.getPreviousSibling(rootModel.children[0].children[0]);
    assert.equal(invalid, null);
  });
});

// Inline snapshot is not supported under describe.parallel config
describe('workspace.exportJSX works', () => {
  it('workspace matches snapshot', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    const doc = workspace.createDoc({ id: 'doc:home' });

    doc.addBlock('affine:page', { title: new doc.Text('hello') });

    expect(workspace.exportJSX()).toMatchInlineSnapshot(`
      <affine:page
        prop:title="hello"
      />
    `);
  });

  it('empty workspace matches snapshot', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    workspace.createDoc({ id: 'doc:home' });

    expect(workspace.exportJSX()).toMatchInlineSnapshot('null');
  });

  it('workspace with multiple blocks children matches snapshot', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    const doc = workspace.createDoc({ id: 'doc:home' });
    doc.load(() => {
      const rootId = doc.addBlock('affine:page', {
        title: new doc.Text(),
      });
      const noteId = doc.addBlock('affine:note', {}, rootId);
      doc.addBlock('affine:paragraph', {}, noteId);
      doc.addBlock('affine:paragraph', {}, noteId);
    });

    expect(workspace.exportJSX()).toMatchInlineSnapshot(/* xml */ `
      <affine:page>
        <affine:note>
          <affine:paragraph
            prop:type="text"
          />
          <affine:paragraph
            prop:type="text"
          />
        </affine:note>
      </affine:page>
    `);
  });
});

describe('workspace search', () => {
  it('search doc meta title', () => {
    const options = createTestOptions();
    const workspace = new Workspace(options);
    const doc = workspace.createDoc({ id: 'doc:home' });
    doc.load(() => {
      const rootId = doc.addBlock('affine:page', {
        title: new doc.Text('test123'),
      });
      const noteId = doc.addBlock('affine:note', {}, rootId);
      doc.addBlock('affine:paragraph', {}, noteId);
    });

    requestIdleCallback(() => {
      const result = workspace.search('test');
      expect(result).toMatchInlineSnapshot(`
      Map {
        "0" => {
          "content": "test123",
          "space": "doc:home",
        },
      }
    `);
    });
  });
});

declare global {
  namespace BlockSuite {
    interface BlockModels {
      'affine:page': BlockModel;
      'affine:paragraph': BlockModel;
      'affine:note': BlockModel;
    }
  }
}
