import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllCategories,
    getAllGames,
    getAllGameIds,
    getAllPublishers,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

async function seedFilteredGames(db: Database): Promise<void> {
    const strategy = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'Strategy games' })
        .returning({ id: categories.id });
    const puzzle = await db
        .insert(categories)
        .values({ name: 'Puzzle', description: 'Puzzle games' })
        .returning({ id: categories.id });
    const adventure = await db
        .insert(categories)
        .values({ name: 'Adventure', description: 'Adventure games' })
        .returning({ id: categories.id });
    const pubOne = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'Publisher One' })
        .returning({ id: publishers.id });
    const pubTwo = await db
        .insert(publishers)
        .values({ name: 'Pub Two', description: 'Publisher Two' })
        .returning({ id: publishers.id });

    await db.insert(games).values([
        { title: 'Alpha Strategy', description: 'Strategy by Pub One', starRating: 4.0, categoryId: strategy[0].id, publisherId: pubOne[0].id },
        { title: 'Beta Puzzle', description: 'Puzzle by Pub One', starRating: 4.4, categoryId: puzzle[0].id, publisherId: pubOne[0].id },
        { title: 'Gamma Strategy', description: 'Strategy by Pub Two', starRating: 3.8, categoryId: strategy[0].id, publisherId: pubTwo[0].id },
        { title: 'Delta Adventure', description: 'Adventure by Pub Two', starRating: 4.2, categoryId: adventure[0].id, publisherId: pubTwo[0].id },
    ]);
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('filters games by category and publisher together', async () => {
        await seedFilteredGames(db);
        const filtered = await getAllGames(db, {
            categories: ['Strategy', 'Puzzle'],
            publishers: ['Pub One'],
        });

        expect(filtered.map((game) => game.title)).toEqual(['Alpha Strategy', 'Beta Puzzle']);
    });

    it('returns distinct categories and publishers in name order', async () => {
        await seedFilteredGames(db);
        const categoriesList = await getAllCategories(db);
        const publishersList = await getAllPublishers(db);

        expect(categoriesList.map((category) => category.name)).toEqual(['Adventure', 'Puzzle', 'Strategy']);
        expect(publishersList.map((publisher) => publisher.name)).toEqual(['Pub One', 'Pub Two']);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
