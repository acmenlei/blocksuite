/* eslint-disable @typescript-eslint/no-restricted-imports */
import '../../database-block/kanban/define.js';
import '../../database-block/table/define.js';

import type { BlockModel, Doc } from '@blocksuite/store';
import { Generator, Schema, Workspace } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { numberPureColumnConfig } from '../../database-block/common/columns/number/define.js';
import { richTextPureColumnConfig } from '../../database-block/common/columns/rich-text/define.js';
import { selectPureColumnConfig } from '../../database-block/common/columns/select/define.js';
import type { DatabaseBlockModel } from '../../database-block/database-model.js';
import { DatabaseBlockSchema } from '../../database-block/database-model.js';
import type { Cell, Column } from '../../database-block/types.js';
import { NoteBlockSchema } from '../../note-block/note-model.js';
import { ParagraphBlockSchema } from '../../paragraph-block/paragraph-model.js';
import { RootBlockSchema } from '../../root-block/root-model.js';

const AffineSchemas = [
  RootBlockSchema,
  NoteBlockSchema,
  ParagraphBlockSchema,
  DatabaseBlockSchema,
];

function createTestOptions() {
  const idGenerator = Generator.AutoIncrement;
  const schema = new Schema();
  schema.register(AffineSchemas);
  return { id: 'test-workspace', idGenerator, schema };
}

function createTestDoc(docId = 'doc0') {
  const options = createTestOptions();
  const workspace = new Workspace(options);
  const doc = workspace.createDoc({ id: docId });
  doc.load();
  return doc;
}

describe('DatabaseManager', () => {
  let doc: Doc;
  let db: DatabaseBlockModel;

  let rootId: BlockModel['id'];
  let noteBlockId: BlockModel['id'];
  let databaseBlockId: BlockModel['id'];
  let p1: BlockModel['id'];
  let p2: BlockModel['id'];
  let col1: Column['id'];
  let col2: Column['id'];
  let col3: Column['id'];

  const selection = [
    { id: '1', value: 'Done', color: 'var(--affine-tag-white)' },
    { id: '2', value: 'TODO', color: 'var(--affine-tag-pink)' },
    { id: '3', value: 'WIP', color: 'var(--affine-tag-blue)' },
  ];

  beforeEach(() => {
    doc = createTestDoc();

    rootId = doc.addBlock('affine:page', {
      title: new doc.Text('database test'),
    });
    noteBlockId = doc.addBlock('affine:note', {}, rootId);

    databaseBlockId = doc.addBlock(
      'affine:database' as BlockSuite.Flavour,
      {
        columns: [],
        titleColumn: 'Title',
      },
      noteBlockId
    );

    const databaseModel = doc.getBlockById(
      databaseBlockId
    ) as DatabaseBlockModel;
    db = databaseModel;

    col1 = db.addColumn('end', numberPureColumnConfig.create('Number'));
    col2 = db.addColumn(
      'end',
      selectPureColumnConfig.create('Single Select', { options: selection })
    );
    col3 = db.addColumn('end', richTextPureColumnConfig.create('Rich Text'));

    doc.updateBlock(databaseModel, {
      columns: [col1, col2, col3],
    });

    p1 = doc.addBlock(
      'affine:paragraph',
      {
        text: new doc.Text('text1'),
      },
      databaseBlockId
    );
    p2 = doc.addBlock(
      'affine:paragraph',
      {
        text: new doc.Text('text2'),
      },
      databaseBlockId
    );

    db.updateCell(p1, {
      columnId: col1,
      value: 0.1,
    });
    db.updateCell(p2, {
      columnId: col2,
      value: [selection[1]],
    });
  });

  test('getColumn', () => {
    const column = {
      ...numberPureColumnConfig.create('testColumnId'),
      id: 'testColumnId',
    };
    db.addColumn('end', column);

    const result = db.getColumn(column.id);
    expect(result).toEqual(column);
  });

  test('addColumn', () => {
    const column = numberPureColumnConfig.create('Test Column');
    const id = db.addColumn('end', column);
    const result = db.getColumn(id);

    expect(result).toMatchObject(column);
    expect(result).toHaveProperty('id');
  });

  test('deleteColumn', () => {
    const column = {
      ...numberPureColumnConfig.create('Test Column'),
      id: 'testColumnId',
    };
    db.addColumn('end', column);
    expect(db.getColumn(column.id)).toEqual(column);

    db.deleteColumn(column.id);
    expect(db.getColumn(column.id)).toBeUndefined();
  });

  test('getCell', () => {
    const modelId = doc.addBlock(
      'affine:paragraph',
      {
        text: new doc.Text('paragraph'),
      },
      noteBlockId
    );
    const column = {
      ...numberPureColumnConfig.create('Test Column'),
      id: 'testColumnId',
    };
    const cell: Cell = {
      columnId: column.id,
      value: 42,
    };

    db.addColumn('end', column);
    db.updateCell(modelId, cell);

    const model = doc.getBlockById(modelId);

    expect(model).not.toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = db.getCell(model!.id, column.id);
    expect(result).toEqual(cell);
  });

  test('updateCell', () => {
    const newRowId = doc.addBlock(
      'affine:paragraph',
      {
        text: new doc.Text('text3'),
      },
      databaseBlockId
    );

    db.updateCell(newRowId, {
      columnId: col2,
      value: [selection[2]],
    });

    const cell = db.getCell(newRowId, col2);
    expect(cell).toEqual({
      columnId: col2,
      value: [selection[2]],
    });
  });

  test('copyCellsByColumn', () => {
    const newColId = db.addColumn(
      'end',
      selectPureColumnConfig.create('Copied Select', { options: selection })
    );

    db.copyCellsByColumn(col2, newColId);

    const cell = db.getCell(p2, newColId);
    expect(cell).toEqual({
      columnId: newColId,
      value: [selection[1]],
    });
  });
});
