/**
 * Unit tests for Column Actions
 * Tests row-tag operations: moveWithRowUpdate, reorderWithRowTags
 */

import { KanbanBoard } from '../../markdownParser';
import * as ColumnActions from '../../actions/column';

// Helper to create a test board with row tags
function createTestBoardWithRows(): KanbanBoard {
    return {
        title: 'Test Board',
        columns: [
            {
                id: 'col-1',
                title: 'Backlog',
                tasks: [{ id: 'task-1', title: 'Task 1', description: '' }]
            },
            {
                id: 'col-2',
                title: 'To Do #row1',
                tasks: [{ id: 'task-2', title: 'Task 2', description: '' }]
            },
            {
                id: 'col-3',
                title: 'In Progress #row1',
                tasks: []
            },
            {
                id: 'col-4',
                title: 'Review #row2',
                tasks: []
            },
            {
                id: 'col-5',
                title: 'Done #row2',
                tasks: []
            }
        ]
    };
}

describe('ColumnActions', () => {
    describe('moveWithRowUpdate', () => {
        it('should move column and update row tag', () => {
            const board = createTestBoardWithRows();
            const action = ColumnActions.moveWithRowUpdate('col-1', 3, 2);

            const result = action.execute(board);

            expect(result).toBe(true);
            // Column should be moved
            expect(board.columns[3].id).toBe('col-1');
            // Row tag should be added
            expect(board.columns[3].title).toBe('Backlog #row2');
        });

        it('should remove row tag when moving to row 1', () => {
            const board = createTestBoardWithRows();
            const action = ColumnActions.moveWithRowUpdate('col-4', 1, 1);

            const result = action.execute(board);

            expect(result).toBe(true);
            // Row tag should be removed
            const movedColumn = board.columns.find(c => c.id === 'col-4');
            expect(movedColumn?.title).toBe('Review');
        });

        it('should update existing row tag', () => {
            const board = createTestBoardWithRows();
            const action = ColumnActions.moveWithRowUpdate('col-2', 4, 2);

            const result = action.execute(board);

            expect(result).toBe(true);
            const movedColumn = board.columns.find(c => c.id === 'col-2');
            expect(movedColumn?.title).toBe('To Do #row2');
        });

        it('should return false for non-existent column', () => {
            const board = createTestBoardWithRows();
            const action = ColumnActions.moveWithRowUpdate('non-existent', 0, 1);

            const result = action.execute(board);

            expect(result).toBe(false);
        });

        it('should have empty targets for full board refresh', () => {
            const action = ColumnActions.moveWithRowUpdate('col-1', 0, 1);
            expect(action.targets).toEqual([]);
        });
    });

    describe('reorderWithRowTags', () => {
        it('should reorder columns according to new order', () => {
            const board = createTestBoardWithRows();
            const newOrder = ['col-5', 'col-4', 'col-3', 'col-2', 'col-1'];
            const action = ColumnActions.reorderWithRowTags(newOrder, 'col-5', 1);

            const result = action.execute(board);

            expect(result).toBe(true);
            expect(board.columns.map(c => c.id)).toEqual(newOrder);
        });

        it('should update row tag for moved column', () => {
            const board = createTestBoardWithRows();
            const newOrder = ['col-1', 'col-4', 'col-2', 'col-3', 'col-5'];
            const action = ColumnActions.reorderWithRowTags(newOrder, 'col-4', 1);

            const result = action.execute(board);

            expect(result).toBe(true);
            // col-4 should have its row tag changed from #row2 to #row1 (removed since row 1)
            const movedColumn = board.columns.find(c => c.id === 'col-4');
            expect(movedColumn?.title).toBe('Review');
        });

        it('should add row tag when moving to row > 1', () => {
            const board = createTestBoardWithRows();
            const newOrder = ['col-2', 'col-3', 'col-4', 'col-5', 'col-1'];
            const action = ColumnActions.reorderWithRowTags(newOrder, 'col-1', 2);

            const result = action.execute(board);

            expect(result).toBe(true);
            const movedColumn = board.columns.find(c => c.id === 'col-1');
            expect(movedColumn?.title).toBe('Backlog #row2');
        });

        it('should return false for non-existent moved column', () => {
            const board = createTestBoardWithRows();
            const action = ColumnActions.reorderWithRowTags(['col-1', 'col-2'], 'non-existent', 1);

            const result = action.execute(board);

            expect(result).toBe(false);
        });

        it('should have empty targets for full board refresh', () => {
            const action = ColumnActions.reorderWithRowTags([], 'col-1', 1);
            expect(action.targets).toEqual([]);
        });
    });
});
