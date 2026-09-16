import { eq, asc, and, avg, count, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

export interface PublisherDetails {
    id: number;
    name: string;
    description: string | null;
}

export interface GameFilters {
    categories?: string[];
    publishers?: string[];
}

export interface PaginatedGames {
    games: Game[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
}

export interface CatalogSummary {
    totalGames: number;
    averageRating: number | null;
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

function buildGameConditions(filters: GameFilters) {
    const normalizedCategories = (filters.categories ?? []).filter((category) => category.trim().length > 0);
    const normalizedPublishers = (filters.publishers ?? []).filter((publisher) => publisher.trim().length > 0);
    const conditions = [];

    if (normalizedCategories.length > 0) {
        conditions.push(inArray(categories.name, normalizedCategories));
    }

    if (normalizedPublishers.length > 0) {
        conditions.push(inArray(publishers.name, normalizedPublishers));
    }

    return conditions;
}

/** All categories ordered by name for the filter UI. */
export async function getAllCategories(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

/** All publishers ordered by name for the filter UI. */
export async function getAllPublishers(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/**
 * Returns a publisher's name and description, or null when the publisher is missing.
 *
 * @param db Injectable database connection used to read the publisher.
 * @param id Publisher identifier used by the static route.
 * @returns Publisher details or null when no matching publisher exists.
 */
export async function getPublisherById(db: Database, id: number): Promise<PublisherDetails | null> {
    const [publisher] = await db
        .select({ id: publishers.id, name: publishers.name, description: publishers.description })
        .from(publishers)
        .where(eq(publishers.id, id));
    return publisher ?? null;
}

/**
 * Returns all games for a publisher in deterministic title order.
 *
 * @param db Injectable database connection used to query games and relations.
 * @param publisherId Publisher identifier whose games should be returned.
 * @returns Games belonging to the publisher, ordered alphabetically by title.
 */
export async function getGamesByPublisher(db: Database, publisherId: number): Promise<Game[]> {
    const rows = await baseGamesQuery(db)
        .where(eq(games.publisherId, publisherId))
        .orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns the catalog size and average rating for all rated games.
 *
 * @param db Injectable database connection used to read catalog aggregates.
 * @returns A deterministic summary with a null average when no games are rated.
 */
export async function getCatalogSummary(db: Database): Promise<CatalogSummary> {
    const [summary] = await db
        .select({
            totalGames: count(games.id),
            averageRating: avg(games.starRating),
        })
        .from(games);

    return {
        totalGames: summary?.totalGames ?? 0,
        averageRating: summary?.averageRating === null || summary?.averageRating === undefined
            ? null
            : Number(summary.averageRating),
    };
}

/** All games ordered by title, optionally filtered to one or more category and publisher names. */
export async function getAllGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const conditions = buildGameConditions(filters);
    const query = conditions.length > 0 ? baseGamesQuery(db).where(and(...conditions)) : baseGamesQuery(db);
    const rows = await query.orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns one stable, title-ordered page of games and its pagination metadata.
 *
 * @param db Injectable database connection used to query games and their relations.
 * @param page One-based page number; values below one are treated as page one.
 * @param pageSize Number of games per page; values below one are treated as one.
 * @param filters Optional category and publisher filters applied before pagination.
 * @returns The requested page, total matching game count, and total page count.
 */
export async function getPaginatedGames(
    db: Database,
    page: number,
    pageSize: number,
    filters: GameFilters = {},
): Promise<PaginatedGames> {
    const normalizedPage = Math.max(1, Math.floor(page));
    const normalizedPageSize = Math.max(1, Math.floor(pageSize));
    const conditions = buildGameConditions(filters);
    const countQuery = db.select({ count: count() }).from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
    const totalCount = (conditions.length > 0 ? await countQuery.where(and(...conditions)) : await countQuery)[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / normalizedPageSize));
    const safePage = Math.min(normalizedPage, totalPages);
    const query = conditions.length > 0 ? baseGamesQuery(db).where(and(...conditions)) : baseGamesQuery(db);
    const rows = await query
        .orderBy(asc(games.title))
        .limit(normalizedPageSize)
        .offset((safePage - 1) * normalizedPageSize);

    return {
        games: rows.map(mapGame),
        page: safePage,
        pageSize: normalizedPageSize,
        totalCount,
        totalPages,
    };
}

/** All game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
