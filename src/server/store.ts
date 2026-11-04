import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Board, BrushStyle, Connector, Operation, Shape, ShapeType } from '../shared/types.ts'
import { ANCHOR_COUNTS, connectionCompatible } from '../shared/types.ts'

export class OperationError extends Error {
	readonly status: number
	readonly code: string

	constructor(status: number, code: string, message: string) {
		super(message)
		this.status = status
		this.code = code
	}
}

function invalid(message: string): never {
	throw new OperationError(400, 'INVALID_REQUEST', message)
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const allowed = new Set([...required, ...optional])
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => allowed.has(key))
	)
}

function validId(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0
}

function validColor(value: unknown): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function validFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

const SHAPE_TYPES = new Set<string>([
	'rectangle',
	'ellipse',
	'text',
	'line',
	'path',
	'frame',
	'note',
	'html',
	'connector',
])
const MAX_HTML_LENGTH = 200_000

function validTitle(value: unknown, label: string): void {
	if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
		invalid(`${label} must be a non-empty string of at most 120 characters`)
	}
}

function validHtml(value: unknown): void {
	if (typeof value !== 'string' || value.length > MAX_HTML_LENGTH) {
		invalid(`html must be a string of at most ${MAX_HTML_LENGTH} characters`)
	}
}

function validateGeometry(value: Record<string, unknown>): void {
	for (const key of ['x', 'y', 'w', 'h']) {
		if (!validFiniteNumber(value[key])) invalid(`${key} must be a finite number`)
	}
	if (value.type !== 'line' && ((value.w as number) < 0 || (value.h as number) < 0)) {
		invalid('shape width and height must be non-negative')
	}
}

function validateShapeShape(value: unknown): asserts value is Shape {
	if (!isObject(value)) invalid('shape must be an object')
	if (!validId(value.id)) invalid('shape id must be a non-empty string')
	if (typeof value.type !== 'string' || !SHAPE_TYPES.has(value.type)) invalid('invalid shape type')
	if (!validColor(value.color)) invalid('shape color must be a non-empty string')

	if (value.type === 'connector') {
		if (!hasExactKeys(value, ['id', 'type', 'from', 'to', 'color'], ['fromAnchor', 'toAnchor'])) {
			invalid('invalid connector shape')
		}
		if (!validId(value.from) || !validId(value.to)) {
			invalid('connector endpoints must be non-empty shape ids')
		}
		if (value.from === value.to) invalid('connector endpoints must be different')
		for (const key of ['fromAnchor', 'toAnchor']) {
			if (!Object.hasOwn(value, key)) continue
			const index = value[key]
			if (!Number.isInteger(index) || (index as number) < 0) {
				invalid(`connector ${key} must be a non-negative integer`)
			}
		}
		return
	}

	const base = ['id', 'type', 'x', 'y', 'w', 'h', 'color']
	if (value.type === 'frame') {
		if (!hasExactKeys(value, base, ['title'])) invalid('invalid frame shape')
		validTitle(value.title, 'frame title')
	} else if (value.type === 'html') {
		if (!hasExactKeys(value, [...base, 'title', 'html'], ['frameId'])) {
			invalid('invalid html shape')
		}
		validTitle(value.title, 'html title')
		validHtml(value.html)
	} else if (value.type === 'text') {
		if (!hasExactKeys(value, base, ['text', 'frameId', 'font', 'fontSize', 'fontWeight'])) {
			invalid('invalid text shape')
		}
	} else if (value.type === 'path') {
		if (!hasExactKeys(value, [...base, 'points', 'brush', 'strokeWidth'], ['frameId'])) {
			invalid('invalid path shape')
		}
		validatePath(value)
	} else if (value.type === 'line') {
		if (!hasExactKeys(value, base, ['text', 'frameId'])) invalid('invalid canvas shape')
	} else if (!hasExactKeys(value, base, ['text', 'frameId'])) {
		invalid('invalid canvas shape')
	}

	validateGeometry(value)
	if (Object.hasOwn(value, 'text') && typeof value.text !== 'string') {
		invalid('shape text must be a string')
	}
	if (Object.hasOwn(value, 'frameId') && !validId(value.frameId)) {
		invalid('frameId must be a non-empty shape id')
	}
	if (Object.hasOwn(value, 'font')) {
		const font = value.font
		if (font !== 'sans' && font !== 'serif' && font !== 'hand' && font !== 'mono') {
			invalid('text font must be sans, serif, hand or mono')
		}
	}
	if (Object.hasOwn(value, 'fontSize')) {
		if (!validFiniteNumber(value.fontSize) || value.fontSize < 8 || value.fontSize > 256) {
			invalid('text fontSize must be between 8 and 256')
		}
	}
	if (Object.hasOwn(value, 'fontWeight')) {
		if (!validFiniteNumber(value.fontWeight) || value.fontWeight < 100 || value.fontWeight > 900) {
			invalid('text fontWeight must be between 100 and 900')
		}
	}
}

function validBrush(value: unknown): value is BrushStyle {
	return value === 'pencil' || value === 'marker' || value === 'brush'
}

function validStrokeWidth(value: unknown): value is number {
	return validFiniteNumber(value) && value >= 1 && value <= 64
}

function validatePoints(value: unknown, w: number, h: number): void {
	if (!Array.isArray(value) || value.length < 2 || value.length > 4096) {
		invalid('path points must contain between 2 and 4096 points')
	}
	for (const point of value) {
		if (!isObject(point) || !hasExactKeys(point, ['x', 'y'])) invalid('invalid path point')
		if (!validFiniteNumber(point.x) || !validFiniteNumber(point.y)) {
			invalid('path point coordinates must be finite numbers')
		}
		if (point.x < 0 || point.x > w || point.y < 0 || point.y > h) {
			invalid('path points must stay inside the path bounds')
		}
	}
}

function validatePath(value: Record<string, unknown>): void {
	if (!validBrush(value.brush)) invalid('path brush must be pencil, marker or brush')
	if (!validStrokeWidth(value.strokeWidth)) {
		invalid('path strokeWidth must be between 1 and 64')
	}
	for (const key of ['x', 'y', 'w', 'h']) {
		if (!validFiniteNumber(value[key])) invalid(`${key} must be a finite number`)
	}
	if ((value.w as number) < 0 || (value.h as number) < 0) {
		invalid('path width and height must be non-negative')
	}
	validatePoints(value.points, value.w as number, value.h as number)
}

function validateBoardState(board: Board): void {
	if (!isObject(board) || !Number.isInteger(board.revision) || board.revision < 0) {
		invalid('invalid board revision')
	}
	if (!Array.isArray(board.shapes)) invalid('invalid board shapes')

	const ids = new Set<string>()
	const frameIds = new Set<string>()
	for (const shape of board.shapes) {
		validateShapeShape(shape)
		if (ids.has(shape.id)) invalid(`duplicate shape id: ${shape.id}`)
		ids.add(shape.id)
		if (shape.type === 'frame') frameIds.add(shape.id)
	}

	for (const shape of board.shapes) {
		if (shape.type === 'connector') {
			validateConnectorReferences(shape, board.shapes)
		} else if (shape.frameId && !frameIds.has(shape.frameId)) {
			invalid(`shape ${shape.id} references a missing frame ${shape.frameId}`)
		}
	}
}

function validateConnectorReferences(connector: Connector, shapes: Shape[]): void {
	const from = shapes.find((shape) => shape.id === connector.from)
	const to = shapes.find((shape) => shape.id === connector.to)
	if (!from || from.type === 'connector' || !to || to.type === 'connector') {
		invalid(`connector ${connector.id} has an invalid endpoint reference`)
	}
	if (!connectionCompatible(from.type, to.type)) {
		invalid(`connector ${connector.id} cannot join a frame to a non-frame shape`)
	}
	if (connector.fromAnchor !== undefined && connector.fromAnchor >= ANCHOR_COUNTS[from.type]) {
		invalid(`connector ${connector.id} fromAnchor is out of range for shape ${from.id}`)
	}
	if (connector.toAnchor !== undefined && connector.toAnchor >= ANCHOR_COUNTS[to.type]) {
		invalid(`connector ${connector.id} toAnchor is out of range for shape ${to.id}`)
	}
}

function migrateLegacyShapes(shapes: unknown): { shapes: unknown; changed: boolean } {
	if (!Array.isArray(shapes)) return { shapes, changed: false }
	const types = new Map<string, string>()
	const retired = new Set<string>()
	for (const shape of shapes) {
		if (!isObject(shape) || typeof shape.id !== 'string' || typeof shape.type !== 'string') continue
		types.set(shape.id, shape.type)
		if (shape.type === 'widget') retired.add(shape.id)
	}
	const kept = shapes.filter((shape) => {
		if (!isObject(shape)) return true
		if (shape.type === 'widget') return false
		return !(
			shape.type === 'connector' &&
			((typeof shape.from === 'string' && retired.has(shape.from)) ||
				(typeof shape.to === 'string' && retired.has(shape.to)))
		)
	})
	const compatible = kept.filter((shape) => {
		if (!isObject(shape) || shape.type !== 'connector') return true
		const from = typeof shape.from === 'string' ? types.get(shape.from) : undefined
		const to = typeof shape.to === 'string' ? types.get(shape.to) : undefined
		if (!from || !to || from === 'connector' || to === 'connector') return true
		return (from === 'frame') === (to === 'frame')
	})
	return { shapes: compatible, changed: compatible.length !== shapes.length }
}

function cloneBoard(board: Board): Board {
	return {
		revision: board.revision,
		shapes: board.shapes.map((shape) => ({ ...shape })) as Shape[],
	}
}

function findShape(board: Board, id: string): Shape | undefined {
	return board.shapes.find((shape) => shape.id === id)
}

const PATCH_KEYS: Record<ShapeType | 'connector', readonly string[]> = {
	rectangle: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	ellipse: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	note: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	line: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	text: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId', 'font', 'fontSize', 'fontWeight'],
	path: ['x', 'y', 'w', 'h', 'color', 'frameId', 'points', 'brush', 'strokeWidth'],
	frame: ['x', 'y', 'w', 'h', 'color', 'title'],
	html: ['x', 'y', 'w', 'h', 'color', 'title', 'html', 'frameId'],
	connector: ['from', 'to', 'color', 'fromAnchor', 'toAnchor'],
}

function validatePatch(target: Shape, patch: Record<string, unknown>): void {
	const allowed = new Set(PATCH_KEYS[target.type])
	for (const key of Object.keys(patch)) {
		if (!allowed.has(key)) invalid(`patch key ${key} is not valid for this shape type`)
	}

	if (Object.hasOwn(patch, 'color') && !validColor(patch.color)) {
		invalid('shape color must be a non-empty string')
	}
	if (target.type === 'connector') {
		for (const key of ['from', 'to']) {
			if (Object.hasOwn(patch, key) && !validId(patch[key])) {
				invalid(`connector ${key} must be a non-empty shape id`)
			}
		}
		for (const key of ['fromAnchor', 'toAnchor']) {
			if (!Object.hasOwn(patch, key)) continue
			const index = patch[key]
			if (!Number.isInteger(index) || (index as number) < 0) {
				invalid(`connector ${key} must be a non-negative integer`)
			}
		}
		return
	}

	for (const key of ['x', 'y', 'w', 'h']) {
		if (Object.hasOwn(patch, key) && !validFiniteNumber(patch[key])) {
			invalid(`${key} must be a finite number`)
		}
	}
	if (target.type !== 'line' && Object.hasOwn(patch, 'w') && (patch.w as number) < 0)
		invalid('shape width must be non-negative')
	if (target.type !== 'line' && Object.hasOwn(patch, 'h') && (patch.h as number) < 0)
		invalid('shape height must be non-negative')
	if (Object.hasOwn(patch, 'text') && typeof patch.text !== 'string')
		invalid('shape text must be a string')
	if (Object.hasOwn(patch, 'frameId')) {
		if (patch.frameId !== null && !validId(patch.frameId)) {
			invalid('frameId must be a non-empty shape id or null')
		}
	}
	if (Object.hasOwn(patch, 'title')) validTitle(patch.title, 'title')
	if (Object.hasOwn(patch, 'html')) validHtml(patch.html)
	if (Object.hasOwn(patch, 'font')) {
		const font = patch.font
		if (font !== 'sans' && font !== 'serif' && font !== 'hand' && font !== 'mono') {
			invalid('text font must be sans, serif, hand or mono')
		}
	}
	if (Object.hasOwn(patch, 'fontSize')) {
		if (!validFiniteNumber(patch.fontSize) || patch.fontSize < 8 || patch.fontSize > 256) {
			invalid('text fontSize must be between 8 and 256')
		}
	}
	if (Object.hasOwn(patch, 'fontWeight')) {
		if (!validFiniteNumber(patch.fontWeight) || patch.fontWeight < 100 || patch.fontWeight > 900) {
			invalid('text fontWeight must be between 100 and 900')
		}
	}
	if (target.type === 'path') {
		if (Object.hasOwn(patch, 'brush') && !validBrush(patch.brush)) {
			invalid('path brush must be pencil, marker or brush')
		}
		if (Object.hasOwn(patch, 'strokeWidth') && !validStrokeWidth(patch.strokeWidth)) {
			invalid('path strokeWidth must be between 1 and 64')
		}
		if (Object.hasOwn(patch, 'points')) {
			validatePoints(
				patch.points,
				(patch.w as number | undefined) ?? (target.w as number),
				(patch.h as number | undefined) ?? (target.h as number),
			)
		}
	}
}

export class BoardStore {
	readonly db: DatabaseSync
	private board: Board

	constructor(dbPath: string) {
		const resolvedPath = resolve(dbPath)
		mkdirSync(dirname(resolvedPath), { recursive: true })
		this.db = new DatabaseSync(resolvedPath)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS board (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				revision INTEGER NOT NULL,
				shapes TEXT NOT NULL
			)
		`)
		this.board = this.load()
	}

	private load(): Board {
		const row = this.db.prepare('SELECT revision, shapes FROM board WHERE id = 1').get() as
			| { revision: number; shapes: string }
			| undefined
		if (!row) {
			const initial: Board = { revision: 0, shapes: [] }
			this.db
				.prepare('INSERT INTO board (id, revision, shapes) VALUES (1, ?, ?)')
				.run(initial.revision, JSON.stringify(initial.shapes))
			return initial
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(row.shapes)
		} catch {
			throw new Error('Invalid board JSON in SQLite')
		}
		const migrated = migrateLegacyShapes(parsed)
		const board = { revision: row.revision, shapes: migrated.shapes } as Board
		validateBoardState(board)
		if (migrated.changed) {
			this.db
				.prepare('UPDATE board SET shapes = ? WHERE id = 1')
				.run(JSON.stringify(migrated.shapes))
		}
		return board
	}

	getBoard(): Board {
		this.board = this.load()
		return cloneBoard(this.board)
	}

	apply(request: unknown): Board {
		this.board = this.load()
		if (!isObject(request)) invalid('request must be an object')
		if (!hasExactKeys(request, ['operations'], ['expectedRevision'])) {
			invalid('invalid operation request')
		}
		if (!Array.isArray(request.operations)) invalid('operations must be an array')
		if (Object.hasOwn(request, 'expectedRevision')) {
			if (!Number.isInteger(request.expectedRevision) || (request.expectedRevision as number) < 0) {
				throw new OperationError(
					400,
					'INVALID_REQUEST',
					'expectedRevision must be a non-negative integer',
				)
			}
			if (request.expectedRevision !== this.board.revision) {
				throw new OperationError(
					409,
					'REVISION_CONFLICT',
					'Board revision does not match expectedRevision',
				)
			}
		}

		const next = cloneBoard(this.board)
		const cascaded = new Set<string>()
		for (const operation of request.operations as Operation[]) {
			if (!isObject(operation)) invalid('operation must be an object')

			if (operation.type === 'create') {
				if (!hasExactKeys(operation, ['type', 'shape'])) invalid('invalid create operation')
				validateShapeShape(operation.shape)
				if (findShape(next, operation.shape.id)) {
					throw new OperationError(
						400,
						'DUPLICATE_ID',
						`shape id already exists: ${operation.shape.id}`,
					)
				}
				if (operation.shape.type === 'connector') {
					validateConnectorReferences(operation.shape, next.shapes)
				}
				next.shapes.push(operation.shape)
				continue
			}

			if (operation.type === 'update') {
				if (!hasExactKeys(operation, ['type', 'id', 'patch'])) invalid('invalid update operation')
				if (!validId(operation.id)) invalid('update id must be a non-empty string')
				if (!isObject(operation.patch)) invalid('update patch must be an object')
				const target = findShape(next, operation.id)
				if (!target) {
					throw new OperationError(404, 'NOT_FOUND', `shape not found: ${operation.id}`)
				}
				validatePatch(target, operation.patch)
				const updated = { ...target, ...operation.patch } as Shape
				if (updated.type !== 'connector' && updated.frameId === null) {
					delete updated.frameId
				}
				validateShapeShape(updated)
				if (updated.type === 'connector') {
					validateConnectorReferences(updated, next.shapes)
				}
				const index = next.shapes.findIndex((shape) => shape.id === operation.id)
				next.shapes[index] = updated
				continue
			}

			if (operation.type === 'delete') {
				if (!hasExactKeys(operation, ['type', 'id'])) invalid('invalid delete operation')
				if (!validId(operation.id)) invalid('delete id must be a non-empty string')
				if (!findShape(next, operation.id)) {
					if (cascaded.has(operation.id)) continue
					throw new OperationError(404, 'NOT_FOUND', `shape not found: ${operation.id}`)
				}
				const removed = findShape(next, operation.id)
				next.shapes = next.shapes.filter((shape) => {
					if (shape.id === operation.id) return false
					if (
						shape.type === 'connector' &&
						(shape.from === operation.id || shape.to === operation.id)
					) {
						cascaded.add(shape.id)
						return false
					}
					return true
				})
				if (removed?.type === 'frame') {
					next.shapes = next.shapes.map((shape) => {
						if (shape.type === 'connector' || shape.frameId !== operation.id) return shape
						const { frameId: _frameId, ...rest } = shape
						return rest as Shape
					})
				}
				continue
			}

			invalid('invalid operation type')
		}

		validateBoardState(next)
		if (request.operations.length > 0) next.revision += 1

		const result = this.db
			.prepare('UPDATE board SET revision = ?, shapes = ? WHERE id = 1 AND revision = ?')
			.run(next.revision, JSON.stringify(next.shapes), this.board.revision)
		if (Number(result.changes) !== 1) {
			this.board = this.load()
			throw new OperationError(
				409,
				'REVISION_CONFLICT',
				'Board revision changed during the operation',
			)
		}
		this.board = next
		return this.getBoard()
	}

	close(): void {
		this.db.close()
	}
}
