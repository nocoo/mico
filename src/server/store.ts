import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
	Board,
	BrushStyle,
	Connector,
	WidgetItem,
	WidgetKind,
	Operation,
	Shape,
} from '../shared/types.ts'
import { ANCHOR_COUNTS } from '../shared/types.ts'

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

function validateShapeShape(value: unknown): asserts value is Shape {
	if (!isObject(value)) invalid('shape must be an object')
	if (!validId(value.id)) invalid('shape id must be a non-empty string')
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

	if (
		value.type !== 'rectangle' &&
		value.type !== 'ellipse' &&
		value.type !== 'text' &&
		value.type !== 'line' &&
		value.type !== 'path' &&
		value.type !== 'frame' &&
		value.type !== 'note' &&
		value.type !== 'widget'
	) {
		invalid('invalid shape type')
	}
	if (value.type === 'widget') {
		if (
			!hasExactKeys(
				value,
				['id', 'type', 'x', 'y', 'w', 'h', 'color', 'widget', 'widgetTitle', 'items'],
				['frameId'],
			)
		) {
			invalid('invalid widget shape')
		}
		validateWidget(value)
	} else if (value.type === 'frame') {
		if (!hasExactKeys(value, ['id', 'type', 'x', 'y', 'w', 'h', 'color', 'title'], ['frameId'])) {
			invalid('invalid frame shape')
		}
		if (
			typeof value.title !== 'string' ||
			value.title.trim().length === 0 ||
			value.title.length > 120
		) {
			invalid('frame title must be a non-empty string of at most 120 characters')
		}
		if (Object.hasOwn(value, 'frameId')) invalid('a frame cannot belong to another frame')
	} else if (
		value.type !== 'path' &&
		value.type !== 'widget' &&
		!hasExactKeys(
			value,
			['id', 'type', 'x', 'y', 'w', 'h', 'color'],
			['text', 'frameId', 'font', 'fontSize', 'fontWeight'],
		)
	) {
		invalid('invalid canvas shape')
	}
	if (value.type === 'path') {
		if (
			!hasExactKeys(
				value,
				['id', 'type', 'x', 'y', 'w', 'h', 'color', 'points', 'brush', 'strokeWidth'],
				['frameId'],
			)
		) {
			invalid('invalid path shape')
		}
		validatePath(value)
	}
	for (const key of ['x', 'y', 'w', 'h']) {
		if (!validFiniteNumber(value[key])) {
			invalid(`${key} must be a finite number`)
		}
	}
	if (value.type !== 'line' && ((value.w as number) < 0 || (value.h as number) < 0)) {
		invalid('shape width and height must be non-negative')
	}
	if (Object.hasOwn(value, 'text') && typeof value.text !== 'string') {
		invalid('shape text must be a string')
	}
	if (Object.hasOwn(value, 'frameId')) {
		if (!validId(value.frameId)) invalid('frameId must be a non-empty shape id')
		if (value.type === 'frame') invalid('a frame cannot belong to another frame')
	}
	if (Object.hasOwn(value, 'title')) {
		if (value.type !== 'frame') invalid('only frames have titles')
	}
	for (const key of ['font', 'fontSize', 'fontWeight']) {
		if (!Object.hasOwn(value, key)) continue
		if (value.type !== 'text') invalid(`${key} is only valid for text shapes`)
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

function validWidgetKind(value: unknown): value is WidgetKind {
	return value === 'todo' || value === 'kanban' || value === 'table' || value === 'timeline'
}

function validateWidgetItems(value: unknown): void {
	if (!Array.isArray(value) || value.length > 200)
		invalid('widget items must be an array of at most 200 items')
	for (const item of value) {
		if (
			!isObject(item) ||
			!hasExactKeys(item, ['id', 'title'], ['done', 'status', 'start', 'end'])
		) {
			invalid('invalid widget item')
		}
		if (!validId(item.id) || typeof item.title !== 'string' || item.title.length > 200) {
			invalid('widget item needs an id and a title of at most 200 characters')
		}
		if (Object.hasOwn(item, 'done') && typeof item.done !== 'boolean')
			invalid('item done must be boolean')
		if (Object.hasOwn(item, 'status') && typeof item.status !== 'string')
			invalid('item status must be a string')
		for (const key of ['start', 'end']) {
			if (Object.hasOwn(item, key) && !validFiniteNumber(item[key]))
				invalid(`item ${key} must be finite`)
		}
	}
}

function validateWidget(value: Record<string, unknown>): void {
	if (!validWidgetKind(value.widget)) invalid('widget must be todo, kanban, table or timeline')
	if (
		typeof value.widgetTitle !== 'string' ||
		value.widgetTitle.trim().length === 0 ||
		value.widgetTitle.length > 120
	) {
		invalid('widgetTitle must be a non-empty string of at most 120 characters')
	}
	validateWidgetItems(value.items)
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
	if (connector.fromAnchor !== undefined && connector.fromAnchor >= ANCHOR_COUNTS[from.type]) {
		invalid(`connector ${connector.id} fromAnchor is out of range for shape ${from.id}`)
	}
	if (connector.toAnchor !== undefined && connector.toAnchor >= ANCHOR_COUNTS[to.type]) {
		invalid(`connector ${connector.id} toAnchor is out of range for shape ${to.id}`)
	}
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

function validatePatch(target: Shape, patch: Record<string, unknown>): void {
	const canvasKeys = new Set([
		'x',
		'y',
		'w',
		'h',
		'color',
		'text',
		'frameId',
		'title',
		'font',
		'fontSize',
		'fontWeight',
		'widget',
		'widgetTitle',
		'items',
	])
	const connectorKeys = new Set(['from', 'to', 'color', 'fromAnchor', 'toAnchor'])
	const allowed =
		target.type === 'connector'
			? connectorKeys
			: target.type === 'path'
				? new Set([...canvasKeys, 'points', 'brush', 'strokeWidth'])
				: canvasKeys

	for (const key of Object.keys(patch)) {
		if (!allowed.has(key)) {
			invalid(`patch key ${key} is not valid for this shape type`)
		}
	}

	if (Object.hasOwn(patch, 'color') && !validColor(patch.color)) {
		invalid('shape color must be a non-empty string')
	}
	if (target.type !== 'connector') {
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
		if (target.type === 'widget') {
			if (
				Object.hasOwn(patch, 'widget') ||
				Object.hasOwn(patch, 'items') ||
				Object.hasOwn(patch, 'widgetTitle')
			) {
				const merged = { ...target, ...patch }
				validateWidget(merged as Record<string, unknown>)
			}
		} else if (
			Object.hasOwn(patch, 'widget') ||
			Object.hasOwn(patch, 'items') ||
			Object.hasOwn(patch, 'widgetTitle')
		) {
			invalid('widget fields are only valid for widget shapes')
		}
		if (Object.hasOwn(patch, 'title')) {
			if (target.type !== 'frame') invalid('only frames have titles')
			if (
				typeof patch.title !== 'string' ||
				patch.title.trim().length === 0 ||
				patch.title.length > 120
			) {
				invalid('frame title must be a non-empty string of at most 120 characters')
			}
		}
		if (Object.hasOwn(patch, 'frameId')) {
			if (target.type === 'frame') invalid('a frame cannot belong to another frame')
			if (!validId(patch.frameId)) invalid('frameId must be a non-empty shape id')
		}
		if (Object.hasOwn(patch, 'font')) {
			const font = patch.font
			if (target.type !== 'text') invalid('font is only valid for text shapes')
			if (font !== 'sans' && font !== 'serif' && font !== 'hand' && font !== 'mono') {
				invalid('text font must be sans, serif, hand or mono')
			}
		}
		if (Object.hasOwn(patch, 'fontSize')) {
			if (target.type !== 'text') invalid('fontSize is only valid for text shapes')
			if (!validFiniteNumber(patch.fontSize) || patch.fontSize < 8 || patch.fontSize > 256) {
				invalid('text fontSize must be between 8 and 256')
			}
		}
		if (Object.hasOwn(patch, 'fontWeight')) {
			if (target.type !== 'text') invalid('fontWeight is only valid for text shapes')
			if (
				!validFiniteNumber(patch.fontWeight) ||
				patch.fontWeight < 100 ||
				patch.fontWeight > 900
			) {
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
	} else {
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
		const board = { revision: row.revision, shapes: parsed } as Board
		validateBoardState(board)
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
