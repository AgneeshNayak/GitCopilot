import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllCategories,
    getAllGames,
    getAllGameIds,
    getAllPublishers,
    getGamesByPublisher,
    getCatalogSummary,
    getGameById,
    getPaginatedGames,
    getPublisherById,
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

    it('returns a stable page of games with pagination metadata', async () => {
        await seedGames(db, 5);

        const result = await getPaginatedGames(db, 2, 2);

        expect(result.totalCount).toBe(5);
        expect(result.totalPages).toBe(3);
        expect(result.page).toBe(2);
        expect(result.games.map((game) => game.title)).toEqual(['Game 03', 'Game 04']);
    });

    it('clamps pagination pages and preserves filters', async () => {
        await seedFilteredGames(db);

        const result = await getPaginatedGames(db, 99, 2, { publishers: ['Pub Two'] });

        expect(result.totalCount).toBe(2);
        expect(result.totalPages).toBe(1);
        expect(result.page).toBe(1);
        expect(result.games.map((game) => game.title)).toEqual(['Delta Adventure', 'Gamma Strategy']);
    });

    it('returns catalog count and average of rated games', async () => {
        await seedFilteredGames(db);
        await db.insert(games).values({
            title: 'Unrated Game',
            description: 'No rating',
            starRating: null,
            categoryId: 1,
            publisherId: 1,
        });

        await expect(getCatalogSummary(db)).resolves.toEqual({
            totalGames: 5,
            averageRating: 4.1,
        });
    });

    it('returns a zero count and null average for an empty catalog', async () => {
        await expect(getCatalogSummary(db)).resolves.toEqual({
            totalGames: 0,
            averageRating: null,
        });
    });

    it('returns distinct categories and publishers in name order', async () => {
        await seedFilteredGames(db);
        const categoriesList = await getAllCategories(db);
        const publishersList = await getAllPublishers(db);

        expect(categoriesList.map((category) => category.name)).toEqual(['Adventure', 'Puzzle', 'Strategy']);
        expect(publishersList.map((publisher) => publisher.name)).toEqual(['Pub One', 'Pub Two']);
    });

    it('returns publisher details and its games in title order', async () => {
        await seedFilteredGames(db);
        const publishersList = await getAllPublishers(db);
        const publisher = await getPublisherById(db, publishersList[0].id);
        const publisherGames = await getGamesByPublisher(db, publishersList[0].id);

        expect(publisher).toEqual({
            id: publishersList[0].id,
            name: 'Pub One',
            description: 'Publisher One',
        });
        expect(publisherGames.map((game) => game.title)).toEqual(['Alpha Strategy', 'Beta Puzzle']);
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
