import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	hasVisibleNoteLabel,
	NOTE_MIN_LABELED_HEIGHT,
	noteLabelHeightDelta,
} from '../shared/noteLayout.ts'
import type {
	ActionItem,
	Board,
	BrushStyle,
	CanvasDetail,
	CanvasSnapshot,
	CanvasSummary,
	Connector,
	Operation,
	Shape,
	ShapeType,
} from '../shared/types.ts'
import { ANCHOR_COUNTS, connectionCompatible } from '../shared/types.ts'
import { getConnectorAnchors } from '../web/anchors.ts'
import { canvasPreview } from './preview.ts'

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
	'image',
	'actions',
	'connector',
])
export const MAX_CANVAS_IMAGES = 5
const MAX_HTML_LENGTH = 200_000
const MAX_ACTION_ITEMS = 200
const MAX_ACTION_ITEM_TEXT = 6000

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

function validLabel(value: unknown): void {
	if (typeof value !== 'string' || value.length > 120) {
		invalid('label must be a string of at most 120 characters')
	}
}

function validateActionItems(value: unknown): asserts value is ActionItem[] {
	if (!Array.isArray(value) || value.length > MAX_ACTION_ITEMS) {
		invalid(`action items must be an array of at most ${MAX_ACTION_ITEMS} entries`)
	}
	const ids = new Set<string>()
	for (const item of value) {
		if (!isObject(item) || !hasExactKeys(item, ['id', 'text', 'done']))
			invalid('invalid action item')
		if (!validId(item.id) || item.id.length > 64) {
			invalid('action item id must be a non-empty string of at most 64 characters')
		}
		if (ids.has(item.id)) invalid(`duplicate action item id: ${item.id}`)
		ids.add(item.id)
		if (
			typeof item.text !== 'string' ||
			item.text.trim().length === 0 ||
			item.text.length > MAX_ACTION_ITEM_TEXT
		) {
			invalid(`action item text must be non-empty and at most ${MAX_ACTION_ITEM_TEXT} characters`)
		}
		if (typeof item.done !== 'boolean') invalid('action item done must be a boolean')
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
		if (!hasExactKeys(value, base, ['title', 'backgroundImageId', 'backgroundFit'])) {
			invalid('invalid frame shape')
		}
		validTitle(value.title, 'frame title')
		if (Object.hasOwn(value, 'backgroundImageId') && !validId(value.backgroundImageId)) {
			invalid('frame backgroundImageId must be a non-empty shape id')
		}
		if (
			Object.hasOwn(value, 'backgroundFit') &&
			value.backgroundFit !== 'cover' &&
			value.backgroundFit !== 'contain' &&
			value.backgroundFit !== 'stretch'
		) {
			invalid('frame backgroundFit must be cover, contain or stretch')
		}
	} else if (value.type === 'image') {
		if (!hasExactKeys(value, [...base, 'imageId'], ['frameId'])) {
			invalid('invalid image shape')
		}
		if (!validId(value.imageId)) invalid('imageId must be a non-empty asset id')
	} else if (value.type === 'html') {
		if (!hasExactKeys(value, [...base, 'title', 'html'], ['frameId'])) {
			invalid('invalid html shape')
		}
		validTitle(value.title, 'html title')
		validHtml(value.html)
	} else if (value.type === 'actions') {
		if (!hasExactKeys(value, [...base, 'title', 'items'], ['frameId'])) {
			invalid('invalid actions shape')
		}
		validTitle(value.title, 'action card title')
		validateActionItems(value.items)
	} else if (value.type === 'note') {
		if (!hasExactKeys(value, base, ['text', 'label', 'frameId'])) {
			invalid('invalid note shape')
		}
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
	if (Object.hasOwn(value, 'label')) validLabel(value.label)
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

function validateBoardState(board: Board, assetIds?: Set<string>): void {
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
		} else {
			if (shape.frameId && !frameIds.has(shape.frameId)) {
				invalid(`shape ${shape.id} references a missing frame ${shape.frameId}`)
			}
			if (shape.type === 'image') {
				if (!shape.imageId) invalid(`image ${shape.id} must reference an asset`)
				if (assetIds && !assetIds.has(shape.imageId)) {
					invalid(`image ${shape.id} references missing asset ${shape.imageId}`)
				}
			}
			if (shape.type === 'frame' && shape.backgroundImageId) {
				const image = board.shapes.find((candidate) => candidate.id === shape.backgroundImageId)
				if (image?.type !== 'image') {
					invalid(
						`frame ${shape.id} references an invalid background image ${shape.backgroundImageId}`,
					)
				}
				if (!shape.backgroundFit) shape.backgroundFit = 'cover'
			}
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
		shapes: board.shapes.map((shape) => ({
			...shape,
			...(shape.type === 'actions' ? { items: shape.items?.map((item) => ({ ...item })) } : {}),
		})) as Shape[],
	}
}

function findShape(board: Board, id: string): Shape | undefined {
	return board.shapes.find((shape) => shape.id === id)
}

const PATCH_KEYS: Record<ShapeType | 'connector', readonly string[]> = {
	rectangle: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	ellipse: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	note: ['x', 'y', 'w', 'h', 'color', 'text', 'label', 'frameId'],
	line: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId'],
	text: ['x', 'y', 'w', 'h', 'color', 'text', 'frameId', 'font', 'fontSize', 'fontWeight'],
	path: ['x', 'y', 'w', 'h', 'color', 'frameId', 'points', 'brush', 'strokeWidth'],
	frame: ['x', 'y', 'w', 'h', 'color', 'title', 'backgroundImageId', 'backgroundFit'],
	image: ['x', 'y', 'w', 'h', 'color', 'imageId', 'frameId'],
	html: ['x', 'y', 'w', 'h', 'color', 'title', 'html', 'frameId'],
	actions: ['x', 'y', 'w', 'h', 'color', 'title', 'items', 'frameId'],
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
	if (Object.hasOwn(patch, 'label')) validLabel(patch.label)
	if (Object.hasOwn(patch, 'frameId')) {
		if (patch.frameId !== null && !validId(patch.frameId)) {
			invalid('frameId must be a non-empty shape id or null')
		}
	}
	if (Object.hasOwn(patch, 'title')) validTitle(patch.title, 'title')
	if (Object.hasOwn(patch, 'items')) validateActionItems(patch.items)
	if (Object.hasOwn(patch, 'backgroundImageId')) {
		if (patch.backgroundImageId !== null && !validId(patch.backgroundImageId)) {
			invalid('backgroundImageId must be a non-empty shape id or null')
		}
	}
	if (
		Object.hasOwn(patch, 'backgroundFit') &&
		patch.backgroundFit !== 'cover' &&
		patch.backgroundFit !== 'contain' &&
		patch.backgroundFit !== 'stretch'
	) {
		invalid('backgroundFit must be cover, contain or stretch')
	}
	if (Object.hasOwn(patch, 'imageId') && !validId(patch.imageId)) {
		invalid('imageId must be a non-empty asset id')
	}
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

interface CanvasRow {
	id: string
	name: string
	revision: number
	shapes: string
	created_at: string
	updated_at: string
}

const DEFAULT_CANVAS_ID = 'main'
const DEFAULT_CANVAS_NAME = 'My canvas'
const MAX_CANVAS_NAME = 80
const MAX_CANVAS_ID = 120

function validCanvasName(value: unknown): string {
	if (typeof value !== 'string') invalid('canvas name must be a string')
	const name = value.trim()
	if (name.length === 0 || name.length > MAX_CANVAS_NAME) {
		invalid(`canvas name must be between 1 and ${MAX_CANVAS_NAME} characters`)
	}
	for (const character of name) {
		const code = character.codePointAt(0) ?? 0
		if (code < 0x20 || code === 0x7f) invalid('canvas name must not contain control characters')
	}
	return name
}

function validCanvasId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CANVAS_ID) {
		invalid(`canvas id must be a non-empty string of at most ${MAX_CANVAS_ID} characters`)
	}
	return value
}

export interface GeneratedImagePlacement {
	canvasId: string
	shapeId: string
	frameId?: string
	x: number
	y: number
	w: number
	h: number
	bytes: Uint8Array
}

interface PlacementBounds {
	left: number
	top: number
	right: number
	bottom: number
}

function shapePlacementBounds(shape: Shape): PlacementBounds | undefined {
	if (shape.type === 'connector') return undefined
	const left = shape.type === 'line' ? Math.min(shape.x, shape.x + shape.w) : shape.x
	const top = shape.type === 'line' ? Math.min(shape.y, shape.y + shape.h) : shape.y
	const right = shape.type === 'line' ? Math.max(shape.x, shape.x + shape.w) : shape.x + shape.w
	const bottom = shape.type === 'line' ? Math.max(shape.y, shape.y + shape.h) : shape.y + shape.h
	return {
		left,
		top: shape.type === 'frame' ? top - 40 : top,
		right,
		bottom,
	}
}

export function connectorPlacementBounds(
	shapes: Shape[],
	connector: Connector,
): PlacementBounds | undefined {
	const from = shapes.find((shape) => shape.id === connector.from)
	const to = shapes.find((shape) => shape.id === connector.to)
	if (!from || !to || from.type === 'connector' || to.type === 'connector') return undefined
	try {
		const anchors = getConnectorAnchors(from, to, {
			fromAnchor: connector.fromAnchor,
			toAnchor: connector.toAnchor,
		})
		const padding = 8
		return {
			left: Math.min(anchors.start.x, anchors.end.x) - padding,
			top: Math.min(anchors.start.y, anchors.end.y) - padding,
			right: Math.max(anchors.start.x, anchors.end.x) + padding,
			bottom: Math.max(anchors.start.y, anchors.end.y) + padding,
		}
	} catch {
		return undefined
	}
}

function overlaps(a: PlacementBounds, b: PlacementBounds): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function addedPlacement(before: PlacementBounds, after: PlacementBounds): PlacementBounds[] {
	const additions: PlacementBounds[] = []
	if (after.top < before.top) {
		additions.push({ left: after.left, top: after.top, right: after.right, bottom: before.top })
	}
	if (after.bottom > before.bottom) {
		additions.push({
			left: after.left,
			top: before.bottom,
			right: after.right,
			bottom: after.bottom,
		})
	}
	const verticalTop = Math.max(after.top, before.top)
	const verticalBottom = Math.min(after.bottom, before.bottom)
	if (after.left < before.left && verticalBottom > verticalTop) {
		additions.push({
			left: after.left,
			top: verticalTop,
			right: before.left,
			bottom: verticalBottom,
		})
	}
	if (after.right > before.right && verticalBottom > verticalTop) {
		additions.push({
			left: before.right,
			top: verticalTop,
			right: after.right,
			bottom: verticalBottom,
		})
	}
	return additions
}

function placementOf(shapes: Shape[], shape: Shape): PlacementBounds | undefined {
	return shape.type === 'connector'
		? connectorPlacementBounds(shapes, shape)
		: shapePlacementBounds(shape)
}

function validateAutomaticNoteGeometry(next: Board, adjustments: Map<string, number>): void {
	for (const [noteId, adjustment] of adjustments) {
		if (adjustment <= 0) continue
		const note = findShape(next, noteId)
		if (note?.type !== 'note') continue
		const after = shapePlacementBounds(note)
		if (!after) continue
		const before = { ...after, bottom: after.bottom - adjustment }
		for (const shape of next.shapes) {
			if (
				shape.id === noteId ||
				(note.type === 'note' && shape.id === note.frameId) ||
				(shape.type === 'connector' && (shape.from === noteId || shape.to === noteId))
			)
				continue
			const bounds = placementOf(next.shapes, shape)
			if (bounds && addedPlacement(before, after).some((region) => overlaps(region, bounds))) {
				throw new OperationError(
					409,
					'NOTE_LABEL_COLLISION',
					`Label growth for note ${noteId} would cover shape ${shape.id}`,
				)
			}
		}
	}

	const frameUpdates = new Map<string, { x: number; y: number; w: number; h: number }>()
	for (const [noteId, adjustment] of adjustments) {
		if (adjustment <= 0) continue
		const note = findShape(next, noteId)
		if (note?.type !== 'note' || !note.frameId) continue
		const frame = findShape(next, note.frameId)
		if (frame?.type !== 'frame') continue
		const body = shapePlacementBounds(note)
		if (!body) continue
		const previous = frameUpdates.get(frame.id) ?? {
			x: frame.x,
			y: frame.y,
			w: frame.w,
			h: frame.h,
		}
		const left = body.left < previous.x ? Math.min(previous.x, body.left - 40) : previous.x
		const top = body.top < previous.y ? Math.min(previous.y, body.top - 40) : previous.y
		const right =
			body.right > previous.x + previous.w
				? Math.max(previous.x + previous.w, body.right + 40)
				: previous.x + previous.w
		const bottom =
			body.bottom > previous.y + previous.h
				? Math.max(previous.y + previous.h, body.bottom + 40)
				: previous.y + previous.h
		if (
			left === frame.x &&
			top === frame.y &&
			right === frame.x + frame.w &&
			bottom === frame.y + frame.h
		) {
			continue
		}
		frameUpdates.set(frame.id, { x: left, y: top, w: right - left, h: bottom - top })
	}

	for (const [frameId, patch] of frameUpdates) {
		const frame = findShape(next, frameId)
		if (frame?.type !== 'frame') continue
		const before = shapePlacementBounds(frame)
		const after = shapePlacementBounds({ ...frame, ...patch } as Shape)
		if (!before || !after) continue
		for (const shape of next.shapes) {
			if (shape.id === frameId) continue
			if (shape.type !== 'connector' && shape.frameId === frameId) continue
			if (shape.type === 'connector') {
				const from = findShape(next, shape.from)
				const to = findShape(next, shape.to)
				if (
					from &&
					from.type !== 'connector' &&
					from.frameId === frameId &&
					to &&
					to.type !== 'connector' &&
					to.frameId === frameId
				)
					continue
			}
			const bounds = placementOf(next.shapes, shape)
			if (bounds && addedPlacement(before, after).some((region) => overlaps(region, bounds))) {
				throw new OperationError(
					409,
					'FRAME_COLLISION',
					`Frame ${frameId} would touch unrelated shape ${shape.id} while making room for a note label`,
				)
			}
		}
		Object.assign(frame, patch)
	}
}

function occupiedPlacement(shapes: Shape[], x: number, y: number, w: number, h: number): boolean {
	const left = x
	const top = y
	const right = x + w
	const bottom = y + h
	for (const shape of shapes) {
		const bounds =
			shape.type === 'connector'
				? connectorPlacementBounds(shapes, shape)
				: shapePlacementBounds(shape)
		if (
			bounds &&
			left < bounds.right &&
			right > bounds.left &&
			top < bounds.bottom &&
			bottom > bounds.top
		) {
			return true
		}
	}
	return false
}

function rightmostClearPosition(
	shapes: Shape[],
	preferred: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
	let rightmost = preferred.x + preferred.w
	let top = preferred.y
	for (const shape of shapes) {
		const bounds =
			shape.type === 'connector'
				? connectorPlacementBounds(shapes, shape)
				: shapePlacementBounds(shape)
		if (!bounds) continue
		if (bounds.right > rightmost) rightmost = bounds.right
		if (bounds.top < top) top = bounds.top
	}
	return { x: rightmost + 64, y: top, w: preferred.w, h: preferred.h }
}

export class BoardStore {
	readonly db: DatabaseSync

	constructor(dbPath: string) {
		const resolvedPath = resolve(dbPath)
		mkdirSync(dirname(resolvedPath), { recursive: true })
		this.db = new DatabaseSync(resolvedPath, { timeout: 1000 })
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS canvases (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				revision INTEGER NOT NULL,
				shapes TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS image_assets (
				id TEXT PRIMARY KEY,
				content_type TEXT NOT NULL,
				bytes BLOB NOT NULL,
				size INTEGER NOT NULL,
				created_at TEXT NOT NULL
			);
		`)
		this.migrateLegacyBoard()
		this.ensureCanvas()
	}

	private migrateLegacyBoard(): void {
		const legacy = this.db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'board'")
			.get()
		if (!legacy) return
		this.db.exec('BEGIN IMMEDIATE')
		try {
			const row = this.db.prepare('SELECT revision, shapes FROM board WHERE id = 1').get() as
				| { revision: number; shapes: string }
				| undefined
			const existing = this.db.prepare('SELECT COUNT(*) AS count FROM canvases').get() as {
				count: number
			}
			if (existing.count === 0 && row) {
				const now = new Date().toISOString()
				this.db
					.prepare(
						'INSERT INTO canvases (id, name, revision, shapes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
					)
					.run(DEFAULT_CANVAS_ID, DEFAULT_CANVAS_NAME, row.revision, row.shapes, now, now)
				this.setSetting('activeCanvasId', DEFAULT_CANVAS_ID)
			}
			this.db.exec('DROP TABLE board')
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	private ensureCanvas(): void {
		const count = this.db.prepare('SELECT COUNT(*) AS count FROM canvases').get() as {
			count: number
		}
		if (count.count === 0) {
			const now = new Date().toISOString()
			this.db
				.prepare(
					'INSERT INTO canvases (id, name, revision, shapes, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)',
				)
				.run(DEFAULT_CANVAS_ID, DEFAULT_CANVAS_NAME, '[]', now, now)
		}
		const active = this.getSetting('activeCanvasId')
		if (!active || !this.findRow(active)) {
			const first = this.db
				.prepare(
					'SELECT id FROM canvases ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1',
				)
				.get() as { id: string } | undefined
			if (first) this.setSetting('activeCanvasId', first.id)
		}
	}

	private getSetting(key: string): string | undefined {
		const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
			| { value: string }
			| undefined
		return row?.value
	}

	getStateVersion(): number {
		const raw = this.getSetting('stateVersion')
		const version = raw === undefined ? 0 : Number(raw)
		return Number.isInteger(version) && version >= 0 ? version : 0
	}

	private bumpStateVersion(): number {
		this.db
			.prepare(
				"INSERT INTO settings (key, value) VALUES ('stateVersion', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
			)
			.run()
		return this.getStateVersion()
	}

	private setSetting(key: string, value: string): void {
		this.db
			.prepare(
				'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
			)
			.run(key, value)
	}

	private findRow(id: string): CanvasRow | undefined {
		return this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as CanvasRow | undefined
	}

	private requireRow(id: string): CanvasRow {
		const row = this.findRow(id)
		if (!row) throw new OperationError(404, 'NOT_FOUND', `canvas not found: ${id}`)
		return row
	}

	private parseRow(row: CanvasRow, persistMigration = false): Board {
		let parsed: unknown
		try {
			parsed = JSON.parse(row.shapes)
		} catch {
			throw new Error('Invalid canvas JSON in SQLite')
		}
		const migrated = migrateLegacyShapes(parsed)
		const board = { revision: row.revision, shapes: migrated.shapes } as Board
		const beforeValidation = JSON.stringify(migrated.shapes)
		validateBoardState(board, this.listImageAssetIds())
		if (
			(migrated.changed || beforeValidation !== JSON.stringify(migrated.shapes)) &&
			persistMigration
		) {
			this.db
				.prepare('UPDATE canvases SET shapes = ? WHERE id = ?')
				.run(JSON.stringify(migrated.shapes), row.id)
		}
		return board
	}

	private summaryOf(row: CanvasRow, includePreview = true): CanvasSummary {
		const summary: CanvasSummary = {
			id: row.id,
			name: row.name,
			revision: row.revision,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
		if (includePreview) summary.preview = canvasPreview(this.parseRow(row).shapes)
		return summary
	}

	private readState(includePreviews: boolean): CanvasSnapshot {
		this.db.exec('BEGIN DEFERRED')
		try {
			const stateVersion = this.getStateVersion()
			const rows = this.db
				.prepare('SELECT * FROM canvases ORDER BY updated_at DESC, created_at DESC, id ASC')
				.all() as unknown as CanvasRow[]
			const configured = this.getSetting('activeCanvasId')
			const active = rows.find((row) => row.id === configured) ?? rows[0]
			if (!active) throw new Error('No canvas exists')
			const canvases = rows.map((row) => this.summaryOf(row, includePreviews))
			const board = this.parseRow(active)
			this.db.exec('COMMIT')
			return { stateVersion, activeCanvasId: active.id, canvases, board }
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	getActiveCanvasId(): string {
		const active = this.getSetting('activeCanvasId')
		if (active && this.findRow(active)) return active
		this.ensureCanvas()
		return this.getSetting('activeCanvasId') ?? DEFAULT_CANVAS_ID
	}

	listCanvases(includePreviews = true): CanvasSnapshot['canvases'] {
		return this.readState(includePreviews).canvases
	}

	getCanvasList(includePreviews = true): {
		stateVersion: number
		activeCanvasId: string
		canvases: CanvasSummary[]
	} {
		const { stateVersion, activeCanvasId, canvases } = this.readState(includePreviews)
		return { stateVersion, activeCanvasId, canvases }
	}

	getCanvasSummary(id: string): CanvasSummary {
		return this.summaryOf(this.requireRow(validCanvasId(id)))
	}

	getState(includePreviews = true): CanvasSnapshot {
		return this.readState(includePreviews)
	}

	getBoard(canvasId?: string): Board {
		const id = canvasId === undefined ? this.getActiveCanvasId() : validCanvasId(canvasId)
		return cloneBoard(this.parseRow(this.requireRow(id), true))
	}

	countImageShapes(canvasId: string): number {
		const board = this.getBoard(validCanvasId(canvasId))
		return board.shapes.filter((shape) => shape.type === 'image').length
	}

	isPlacementClear(canvasId: string, x: number, y: number, w: number, h: number): boolean {
		const board = this.getBoard(validCanvasId(canvasId))
		return !occupiedPlacement(board.shapes, x, y, w, h)
	}

	placeGeneratedImage(request: GeneratedImagePlacement): {
		canvasId: string
		canvas: CanvasSummary
		board: Board
		imageId: string
		position: { x: number; y: number; w: number; h: number }
		backgroundApplied: boolean
	} {
		const canvasId = validCanvasId(request.canvasId)
		const w = request.w
		const h = request.h
		if (!validFiniteNumber(request.x) || !validFiniteNumber(request.y)) {
			throw new OperationError(400, 'INVALID_REQUEST', 'x and y must be finite numbers')
		}
		if (!validFiniteNumber(w) || w < 1 || !validFiniteNumber(h) || h < 1) {
			throw new OperationError(
				400,
				'INVALID_REQUEST',
				'Generated image dimensions must be positive finite numbers',
			)
		}
		if (
			typeof request.bytes !== 'object' ||
			!(request.bytes instanceof Uint8Array) ||
			request.bytes.byteLength === 0
		) {
			throw new OperationError(400, 'INVALID_REQUEST', 'Generated image bytes must be non-empty')
		}

		this.db.exec('BEGIN IMMEDIATE')
		try {
			const row = this.requireRow(canvasId)
			const board = this.parseRow(row)
			if (board.shapes.filter((shape) => shape.type === 'image').length >= MAX_CANVAS_IMAGES) {
				throw new OperationError(
					409,
					'IMAGE_CAP_REACHED',
					`This canvas already has ${MAX_CANVAS_IMAGES} image shapes. Reuse or remove an existing image shape instead of generating another.`,
				)
			}

			if (findShape(board, request.shapeId)) {
				throw new OperationError(400, 'DUPLICATE_ID', `shape id already exists: ${request.shapeId}`)
			}
			let position = { x: request.x, y: request.y, w, h }
			if (occupiedPlacement(board.shapes, position.x, position.y, position.w, position.h)) {
				position = rightmostClearPosition(board.shapes, position)
			}

			const imageId = this.saveImage(request.bytes, 'image/png')
			const next = cloneBoard(board)
			const shape: Shape = {
				id: request.shapeId,
				type: 'image',
				x: position.x,
				y: position.y,
				w: position.w,
				h: position.h,
				color: '#2b3038',
				imageId,
			}
			if (findShape(next, shape.id)) {
				throw new OperationError(400, 'DUPLICATE_ID', `shape id already exists: ${shape.id}`)
			}
			next.shapes.push(shape)

			let backgroundApplied = false
			if (request.frameId) {
				const frame = findShape(next, request.frameId)
				if (frame?.type === 'frame' && !frame.backgroundImageId) {
					frame.backgroundImageId = shape.id
					frame.backgroundFit = 'cover'
					backgroundApplied = true
				}
			}

			const assetIds = this.listImageAssetIds()
			validateBoardState(next, assetIds)
			if (next.shapes.filter((item) => item.type === 'image').length > MAX_CANVAS_IMAGES) {
				throw new OperationError(
					409,
					'IMAGE_CAP_REACHED',
					`A canvas cannot contain more than ${MAX_CANVAS_IMAGES} image shapes`,
				)
			}
			next.revision += 1
			const updatedAt = new Date().toISOString()
			const result = this.db
				.prepare(
					'UPDATE canvases SET revision = ?, shapes = ?, updated_at = ? WHERE id = ? AND revision = ?',
				)
				.run(next.revision, JSON.stringify(next.shapes), updatedAt, canvasId, board.revision)
			if (Number(result.changes) !== 1) {
				throw new OperationError(
					409,
					'REVISION_CONFLICT',
					'Canvas revision changed during image insertion',
				)
			}
			this.db.exec('COMMIT')
			const updatedRow = this.requireRow(canvasId)
			return {
				canvasId,
				canvas: this.summaryOf(updatedRow),
				board: cloneBoard(next),
				imageId,
				position,
				backgroundApplied,
			}
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	getCanvas(canvasId: string): CanvasDetail {
		const id = validCanvasId(canvasId)
		const row = this.requireRow(id)
		return { canvas: this.summaryOf(row), board: this.parseRow(row) }
	}

	private validImageId(value: unknown): string {
		if (
			typeof value !== 'string' ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
		) {
			throw new OperationError(400, 'INVALID_IMAGE_ID', 'Invalid image id')
		}
		return value
	}

	private listImageAssetIds(): Set<string> {
		const rows = this.db.prepare('SELECT id FROM image_assets').all() as unknown as { id: string }[]
		return new Set(rows.map((row) => row.id))
	}

	saveImage(
		bytes: Uint8Array,
		contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
	): string {
		const id = randomUUID()
		this.db
			.prepare(
				'INSERT INTO image_assets (id, content_type, bytes, size, created_at) VALUES (?, ?, ?, ?, ?)',
			)
			.run(id, contentType, Buffer.from(bytes), bytes.byteLength, new Date().toISOString())
		return id
	}

	getImage(id: unknown): { bytes: Uint8Array; contentType: string } | undefined {
		const assetId = this.validImageId(id)
		const row = this.db
			.prepare('SELECT content_type, bytes FROM image_assets WHERE id = ?')
			.get(assetId) as { content_type: string; bytes: Uint8Array } | undefined
		if (!row) return undefined
		return { bytes: Buffer.from(row.bytes), contentType: row.content_type }
	}

	apply(request: unknown): Board {
		return this.applyRequest(request).board
	}

	applyRequest(request: unknown): { canvasId: string; canvas: CanvasSummary; board: Board } {
		if (!isObject(request)) invalid('request must be an object')
		if (!hasExactKeys(request, ['operations'], ['expectedRevision', 'canvasId'])) {
			invalid('invalid operation request')
		}
		if (!Array.isArray(request.operations)) invalid('operations must be an array')
		const canvasId = Object.hasOwn(request, 'canvasId')
			? validCanvasId(request.canvasId)
			: this.getActiveCanvasId()
		const row = this.requireRow(canvasId)
		const board = this.parseRow(row)
		if (Object.hasOwn(request, 'expectedRevision')) {
			if (!Number.isInteger(request.expectedRevision) || (request.expectedRevision as number) < 0) {
				throw new OperationError(
					400,
					'INVALID_REQUEST',
					'expectedRevision must be a non-negative integer',
				)
			}
			if (request.expectedRevision !== board.revision) {
				throw new OperationError(
					409,
					'REVISION_CONFLICT',
					'Canvas revision does not match expectedRevision',
				)
			}
		}

		const next = cloneBoard(board)
		const labelHeightAdjustments = new Map<string, number>()
		const cascaded = new Set<string>()
		const assetIds = this.listImageAssetIds()
		let createsImage = false
		for (const operation of request.operations as Operation[]) {
			if (!isObject(operation)) invalid('operation must be an object')

			if (operation.type === 'create') {
				if (!hasExactKeys(operation, ['type', 'shape'])) invalid('invalid create operation')
				validateShapeShape(operation.shape)
				if (
					operation.shape.type === 'note' &&
					hasVisibleNoteLabel(operation.shape.label) &&
					operation.shape.h < NOTE_MIN_LABELED_HEIGHT
				) {
					invalid(`labeled note height must be at least ${NOTE_MIN_LABELED_HEIGHT}`)
				}
				if (operation.shape.type === 'image') createsImage = true
				if (operation.shape.type === 'image' && !assetIds.has(operation.shape.imageId ?? '')) {
					throw new OperationError(
						400,
						'MISSING_IMAGE_ASSET',
						`image references missing asset ${operation.shape.imageId}`,
					)
				}
				if (
					operation.shape.type === 'frame' &&
					operation.shape.backgroundImageId &&
					!operation.shape.backgroundFit
				) {
					operation.shape.backgroundFit = 'cover'
				}
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

			if (operation.type === 'restore') {
				if (!hasExactKeys(operation, ['type', 'shape', 'index']))
					invalid('invalid restore operation')
				if (!Object.hasOwn(request, 'expectedRevision'))
					invalid('restore requires expectedRevision')
				if (!Number.isInteger(operation.index) || operation.index < 0)
					invalid('invalid restore index')
				validateShapeShape(operation.shape)
				if (operation.shape.type === 'image') createsImage = true
				labelHeightAdjustments.delete(operation.shape.id)
				next.shapes = next.shapes.filter((shape) => shape.id !== operation.shape.id)
				next.shapes.splice(Math.min(operation.index, next.shapes.length), 0, operation.shape)
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
				if (target.type === 'note' && updated.type === 'note') {
					if (Object.hasOwn(operation.patch, 'h')) {
						labelHeightAdjustments.delete(target.id)
						if (hasVisibleNoteLabel(updated.label) && updated.h < NOTE_MIN_LABELED_HEIGHT) {
							invalid(`labeled note height must be at least ${NOTE_MIN_LABELED_HEIGHT}`)
						}
					} else {
						const adjustment = noteLabelHeightDelta(target.label, updated.label)
						if (adjustment !== 0) updated.h += adjustment
						if (hasVisibleNoteLabel(updated.label) && updated.h < NOTE_MIN_LABELED_HEIGHT) {
							invalid(`labeled note height must be at least ${NOTE_MIN_LABELED_HEIGHT}`)
						}
						if (adjustment !== 0) {
							labelHeightAdjustments.set(
								target.id,
								(labelHeightAdjustments.get(target.id) ?? 0) + adjustment,
							)
						}
					}
				}
				if (updated.type !== 'connector' && updated.frameId === null) {
					delete updated.frameId
				}
				if (updated.type === 'frame' && updated.backgroundImageId === null) {
					delete updated.backgroundImageId
				}
				if (updated.type === 'image' && Object.hasOwn(operation.patch, 'imageId')) {
					if (!assetIds.has(updated.imageId ?? '')) {
						throw new OperationError(
							400,
							'MISSING_IMAGE_ASSET',
							`image references missing asset ${updated.imageId}`,
						)
					}
				}
				validateShapeShape(updated)
				if (updated.type === 'connector') {
					validateConnectorReferences(updated, next.shapes)
				}
				const index = next.shapes.findIndex((shape) => shape.id === operation.id)
				next.shapes[index] = updated
				continue
			}

			if (operation.type === 'set_action_done') {
				if (!hasExactKeys(operation, ['type', 'id', 'itemId', 'done'])) {
					invalid('invalid set_action_done operation')
				}
				if (!Object.hasOwn(request, 'expectedRevision')) {
					invalid('set_action_done requires expectedRevision')
				}
				if (!validId(operation.id) || !validId(operation.itemId) || operation.itemId.length > 64) {
					invalid(
						'set_action_done id and itemId must be non-empty strings, with itemId at most 64 characters',
					)
				}
				if (typeof operation.done !== 'boolean') invalid('set_action_done done must be a boolean')
				const target = findShape(next, operation.id)
				if (!target) {
					throw new OperationError(404, 'NOT_FOUND', `shape not found: ${operation.id}`)
				}
				if (target.type !== 'actions') {
					invalid('set_action_done target must be an actions shape')
				}
				const itemIndex = target.items?.findIndex((item) => item.id === operation.itemId) ?? -1
				if (itemIndex < 0) {
					throw new OperationError(
						404,
						'NOT_FOUND',
						`action item not found: ${operation.id}/${operation.itemId}`,
					)
				}
				const items = target.items?.map((item, index) =>
					index === itemIndex ? { ...item, done: operation.done } : { ...item },
				)
				const updated: Shape = { ...target, items }
				validateShapeShape(updated)
				next.shapes[next.shapes.findIndex((shape) => shape.id === operation.id)] = updated
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
				labelHeightAdjustments.delete(operation.id)
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
				if (removed?.type === 'image') {
					next.shapes = next.shapes.map((shape) => {
						if (shape.type !== 'frame' || shape.backgroundImageId !== operation.id) return shape
						const { backgroundImageId: _backgroundImageId, ...rest } = shape
						return rest as Shape
					})
				}
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

		validateAutomaticNoteGeometry(next, labelHeightAdjustments)
		validateBoardState(next, assetIds)
		if (
			createsImage &&
			next.shapes.filter((shape) => shape.type === 'image').length > MAX_CANVAS_IMAGES
		) {
			throw new OperationError(
				409,
				'IMAGE_CAP_REACHED',
				`A canvas cannot contain more than ${MAX_CANVAS_IMAGES} image shapes`,
			)
		}
		if (request.operations.length > 0) next.revision += 1
		const updatedAt = new Date().toISOString()
		const result = this.db
			.prepare(
				'UPDATE canvases SET revision = ?, shapes = ?, updated_at = ? WHERE id = ? AND revision = ?',
			)
			.run(next.revision, JSON.stringify(next.shapes), updatedAt, canvasId, board.revision)
		if (Number(result.changes) !== 1) {
			throw new OperationError(
				409,
				'REVISION_CONFLICT',
				'Canvas revision changed during the operation',
			)
		}
		const updatedRow = this.requireRow(canvasId)
		return {
			canvasId,
			canvas: this.summaryOf(updatedRow),
			board: cloneBoard(next),
		}
	}

	createCanvas(name?: unknown, activate = false): { state: CanvasSnapshot; canvas: CanvasSummary } {
		const canvasName = name === undefined ? 'Untitled canvas' : validCanvasName(name)
		const id = randomUUID()
		const now = new Date().toISOString()
		this.db.exec('BEGIN IMMEDIATE')
		try {
			this.db
				.prepare(
					'INSERT INTO canvases (id, name, revision, shapes, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)',
				)
				.run(id, canvasName, '[]', now, now)
			if (activate) this.setSetting('activeCanvasId', id)
			this.bumpStateVersion()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
		const state = this.getState()
		const canvas = state.canvases.find((candidate) => candidate.id === id)
		if (!canvas) throw new Error('Created canvas is missing from the state')
		return { state, canvas }
	}

	renameCanvas(canvasId: string, name: unknown): CanvasSnapshot {
		const id = validCanvasId(canvasId)
		const canvasName = validCanvasName(name)
		this.db.exec('BEGIN IMMEDIATE')
		try {
			this.requireRow(id)
			this.db.prepare('UPDATE canvases SET name = ? WHERE id = ?').run(canvasName, id)
			this.bumpStateVersion()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
		return this.getState()
	}

	deleteCanvas(canvasId: string): CanvasSnapshot {
		const id = validCanvasId(canvasId)
		this.db.exec('BEGIN IMMEDIATE')
		try {
			this.requireRow(id)
			const count = this.db.prepare('SELECT COUNT(*) AS count FROM canvases').get() as {
				count: number
			}
			if (count.count <= 1) {
				throw new OperationError(400, 'LAST_CANVAS', 'A board must keep at least one canvas')
			}
			this.db.prepare('DELETE FROM canvases WHERE id = ?').run(id)
			if (this.getSetting('activeCanvasId') === id) {
				const next = this.db
					.prepare(
						'SELECT id FROM canvases ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1',
					)
					.get() as { id: string } | undefined
				if (next) this.setSetting('activeCanvasId', next.id)
			}
			this.bumpStateVersion()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
		return this.getState()
	}

	activateCanvas(canvasId: string): CanvasSnapshot {
		const id = validCanvasId(canvasId)
		this.db.exec('BEGIN IMMEDIATE')
		try {
			this.requireRow(id)
			this.setSetting('activeCanvasId', id)
			this.bumpStateVersion()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
		return this.getState()
	}

	close(): void {
		this.db.close()
	}
}
