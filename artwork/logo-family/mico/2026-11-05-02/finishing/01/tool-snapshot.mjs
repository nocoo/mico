import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function makeMatteProtection(width, height, regions) {
	if (!regions?.length) return null;
	const polygons = regions.map(({ name, points }) => {
		if (
			!name ||
			!Array.isArray(points) ||
			points.length < 3 ||
			points.some(
				(point) =>
					!Array.isArray(point) ||
					point.length !== 2 ||
					point.some(
						(value) => !Number.isFinite(value) || value < 0 || value > 2048,
					),
			)
		)
			throw new Error(
				"Matte protection requires named polygons in native 2048 coordinates.",
			);
		return `<polygon points="${points.map((point) => point.join(",")).join(" ")}" fill="white"/>`;
	});
	return sharp(
		Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 2048 2048"><rect width="2048" height="2048" fill="black"/>${polygons.join("")}</svg>`,
		),
	)
		.extractChannel(0)
		.raw()
		.toBuffer();
}

function extractWhite(rgb, width, height, settings, protection = null) {
	const count = width * height;
	const background = new Uint8Array(count);
	const queue = new Uint32Array(count);
	let head = 0;
	let tail = 0;
	const neighbors = (index, visit) => {
		const x = index % width;
		if (x > 0) visit(index - 1);
		if (x < width - 1) visit(index + 1);
		if (index >= width) visit(index - width);
		if (index < count - width) visit(index + width);
		if (x > 0 && index >= width) visit(index - width - 1);
		if (x < width - 1 && index >= width) visit(index - width + 1);
		if (x > 0 && index < count - width) visit(index + width - 1);
		if (x < width - 1 && index < count - width) visit(index + width + 1);
	};
	const visitWhite = (index) => {
		if (background[index] || (protection && protection[index] > 0)) return;
		const start = index * 3;
		const low = Math.min(rgb[start], rgb[start + 1], rgb[start + 2]);
		const high = Math.max(rgb[start], rgb[start + 1], rgb[start + 2]);
		if (low < settings.minimumChannel || high - low > settings.maximumChroma)
			return;
		background[index] = 1;
		queue[tail++] = index;
	};
	for (let x = 0; x < width; x++) {
		visitWhite(x);
		visitWhite((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		visitWhite(y * width);
		visitWhite(y * width + width - 1);
	}
	for (const point of settings.backgroundSeedsAt2048 ?? []) {
		if (
			!Array.isArray(point) ||
			point.length !== 2 ||
			point.some(
				(value) => !Number.isFinite(value) || value < 0 || value >= 2048,
			)
		)
			throw new Error(
				"Background seeds must be valid native 2048 coordinates.",
			);
		const index =
			Math.floor((point[1] * height) / 2048) * width +
			Math.floor((point[0] * width) / 2048);
		visitWhite(index);
		if (!background[index])
			throw new Error(
				"An interior background seed does not match the sampled white matte.",
			);
	}
	while (head < tail) neighbors(queue[head++], visitWhite);
	let backgroundPixels = tail;
	let removedComponents = 0;
	let removedComponentPixels = 0;
	if (settings.minimumComponentPixels > 0) {
		const seen = new Uint8Array(count);
		for (let start = 0; start < count; start++) {
			if (background[start] || seen[start]) continue;
			head = 0;
			tail = 0;
			const visitForeground = (index) => {
				if (background[index] || seen[index]) return;
				seen[index] = 1;
				queue[tail++] = index;
			};
			visitForeground(start);
			while (head < tail) neighbors(queue[head++], visitForeground);
			if (tail >= settings.minimumComponentPixels) continue;
			for (let index = 0; index < tail; index++) background[queue[index]] = 1;
			backgroundPixels += tail;
			removedComponentPixels += tail;
			removedComponents++;
		}
	}
	if (backgroundPixels < count * 0.1 || backgroundPixels > count * 0.95)
		throw new Error("Unexpected foreground coverage; inspect the white matte.");

	const distance = new Uint8Array(count).fill(255);
	head = 0;
	tail = 0;
	for (let index = 0; index < count; index++) {
		if (background[index]) {
			distance[index] = 0;
			continue;
		}
		neighbors(index, (neighbor) => {
			if (background[neighbor] && distance[index] === 255) {
				distance[index] = 1;
				queue[tail++] = index;
			}
		});
	}
	while (head < tail) {
		const index = queue[head++];
		if (distance[index] >= settings.interiorDistance) continue;
		neighbors(index, (neighbor) => {
			if (distance[neighbor] === 255) {
				distance[neighbor] = distance[index] + 1;
				queue[tail++] = neighbor;
			}
		});
	}

	const rgba = Buffer.alloc(count * 4);
	const alpha = Buffer.alloc(count);
	let softPixels = 0;
	let left = width;
	let top = height;
	let right = 0;
	let bottom = 0;
	for (let index = 0; index < count; index++) {
		if (background[index]) continue;
		const x = index % width;
		const y = Math.floor(index / width);
		const source = index * 3;
		let opacity = 1;
		if (distance[index] <= settings.edgeBand) {
			let nearest = -1;
			let bestDistance = Infinity;
			const radius = settings.searchRadius;
			for (let dy = -radius; dy <= radius; dy++) {
				for (let dx = -radius; dx <= radius; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					const candidateDistance = dx * dx + dy * dy;
					if (
						nx < 0 ||
						nx >= width ||
						ny < 0 ||
						ny >= height ||
						candidateDistance >= bestDistance
					)
						continue;
					const candidate = ny * width + nx;
					if (distance[candidate] < settings.interiorDistance) continue;
					nearest = candidate;
					bestDistance = candidateDistance;
				}
			}
			if (nearest >= 0) {
				let dot = 0;
				let foregroundEnergy = 0;
				let observedEnergy = 0;
				for (let channel = 0; channel < 3; channel++) {
					const matte = settings.backgroundRgb[channel];
					const observed = matte - rgb[source + channel];
					const foreground = matte - rgb[nearest * 3 + channel];
					dot += observed * foreground;
					foregroundEnergy += foreground * foreground;
					observedEnergy += observed * observed;
				}
				const alignment = dot / Math.sqrt(foregroundEnergy * observedEnergy);
				if (
					foregroundEnergy > 0 &&
					(alignment >= settings.minimumColorAlignment ||
						observedEnergy < settings.maximumMatteEnergy)
				)
					opacity = Math.max(0.01, Math.min(1, dot / foregroundEnergy));
			}
		}
		if (protection?.[index])
			opacity = Math.max(opacity, protection[index] / 255);
		alpha[index] = Math.round(opacity * 255);
		if (alpha[index] < 255) softPixels++;
		for (let channel = 0; channel < 3; channel++) {
			const matte = settings.backgroundRgb[channel];
			rgba[index * 4 + channel] = Math.max(
				0,
				Math.min(
					255,
					Math.round(matte + (rgb[source + channel] - matte) / opacity),
				),
			);
		}
		rgba[index * 4 + 3] = alpha[index];
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x);
		bottom = Math.max(bottom, y);
	}
	return {
		rgba,
		alpha,
		statistics: {
			backgroundPixels,
			foregroundPixels: count - backgroundPixels,
			softEdgePixels: softPixels,
			removedComponents,
			removedComponentPixels,
			bounds: { left, top, right, bottom },
		},
	};
}

function backgroundSvg(size, colors) {
	const tones = {
		motif: { color: colors.motif, opacity: colors.motifOpacity },
		highlight: { color: "#ffffff", opacity: colors.highlightOpacity },
		ribbon: { color: "#ffffff", opacity: colors.ribbonOpacity },
	};
	if (!colors.pattern?.name || !colors.pattern.layers?.length)
		throw new Error("Provide a named, project-specific background pattern.");
	const layers = colors.pattern.layers.map(({ d, tone, strokeWidth }) => {
		const paint = tones[tone];
		if (!paint || !d)
			throw new Error("A background path needs a known tone and geometry.");
		return strokeWidth
			? `<path d="${d}" fill="none" stroke="${paint.color}" stroke-width="${strokeWidth}" opacity="${paint.opacity}"/>`
			: `<path d="${d}" fill="${paint.color}" opacity="${paint.opacity}"/>`;
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
<title>${colors.pattern.name}</title>
<defs><radialGradient id="field" cx="26%" cy="14%" r="115%"><stop stop-color="${colors.light}"/><stop offset=".52" stop-color="${colors.base}"/><stop offset="1" stop-color="${colors.shade}"/></radialGradient></defs>
<path fill="url(#field)" d="M0 0h1024v1024H0z"/>
<g stroke-linecap="round">${layers.join("\n")}</g></svg>`;
}

async function makeShadow(alpha, width, height, settings) {
	const rgba = Buffer.alloc(width * height * 4);
	const scale = width / 2048;
	let shadowAlpha = alpha;
	let shadowWidth = width;
	let shadowHeight = height;
	if (settings.projectionScale) {
		if (
			settings.projectionScale.length !== 2 ||
			settings.projectionScale.some(
				(value) => !Number.isFinite(value) || value <= 0 || value > 1,
			)
		)
			throw new Error("Shadow projection needs two scales between 0 and 1.");
		shadowWidth = Math.max(1, Math.round(width * settings.projectionScale[0]));
		shadowHeight = Math.max(
			1,
			Math.round(height * settings.projectionScale[1]),
		);
		shadowAlpha = await sharp(alpha, { raw: { width, height, channels: 1 } })
			.resize(shadowWidth, shadowHeight)
			.toColourspace("b-w")
			.raw()
			.toBuffer();
	}
	const [dx, dy] = settings.offsetAt2048.map((value) =>
		Math.round(value * scale),
	);
	const left = Math.floor((width - shadowWidth) / 2);
	const top = Math.floor((height - shadowHeight) / 2);
	for (let y = 0; y < shadowHeight; y++) {
		for (let x = 0; x < shadowWidth; x++) {
			const nx = x + left + dx;
			const ny = y + top + dy;
			if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
			const target = (ny * width + nx) * 4;
			rgba[target] = settings.color[0];
			rgba[target + 1] = settings.color[1];
			rgba[target + 2] = settings.color[2];
			rgba[target + 3] = Math.round(
				shadowAlpha[y * shadowWidth + x] * settings.opacity,
			);
		}
	}
	return sharp(rgba, { raw: { width, height, channels: 4 } })
		.blur(Math.max(0.3, settings.blurAt2048 * scale))
		.png()
		.toBuffer();
}

async function placeLayer(bytes, width, height, framing = {}) {
	const scale = framing.scale ?? 1;
	const offset = framing.offsetAt2048 ?? [0, 0];
	if (offset.length !== 2 || offset.some((value) => !Number.isFinite(value)))
		throw new Error(
			"Placement offset must contain two finite pixel coordinates.",
		);
	if (scale === 1 && offset.every((value) => value === 0)) return bytes;
	const placedWidth = Math.round(width * scale);
	const placedHeight = Math.round(height * scale);
	const left =
		Math.floor((width - placedWidth) / 2) +
		Math.round((offset[0] * width) / 2048);
	const top =
		Math.floor((height - placedHeight) / 2) +
		Math.round((offset[1] * height) / 2048);
	const cropLeft = Math.max(0, -left);
	const cropTop = Math.max(0, -top);
	const cropWidth = Math.min(placedWidth - cropLeft, width - Math.max(0, left));
	const cropHeight = Math.min(
		placedHeight - cropTop,
		height - Math.max(0, top),
	);
	if (cropWidth <= 0 || cropHeight <= 0)
		throw new Error(
			"Placement moves the complete foreground outside the canvas.",
		);
	const resized =
		scale === 1
			? bytes
			: await sharp(bytes).resize(placedWidth, placedHeight).png().toBuffer();
	const placed =
		cropLeft ||
		cropTop ||
		cropWidth !== placedWidth ||
		cropHeight !== placedHeight
			? await sharp(resized)
					.extract({
						left: cropLeft,
						top: cropTop,
						width: cropWidth,
						height: cropHeight,
					})
					.png()
					.toBuffer()
			: resized;
	return sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([
			{
				input: placed,
				left: Math.max(0, left),
				top: Math.max(0, top),
			},
		])
		.png()
		.toBuffer();
}

async function makeEmission(rgb, alpha, width, height, settings) {
	const mask = Buffer.alloc(width * height);
	const rgba = Buffer.alloc(width * height * 4);
	const factor = width / 2048;
	const [cx, cy, rx, ry] = settings.mask.ellipseAt2048.map(
		(value) => value * factor,
	);
	let selectedPixels = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (!alpha[index] || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1)
				continue;
			const [red, green, blue] = rgb.subarray(index * 3, index * 3 + 3);
			if (
				red < settings.mask.minimumRed ||
				green < settings.mask.minimumGreen ||
				blue > settings.mask.maximumBlue ||
				red - blue < settings.mask.minimumWarmth
			)
				continue;
			mask[index] = alpha[index];
			selectedPixels++;
		}
	}
	if (!selectedPixels)
		throw new Error(`Emission source mask is empty: ${settings.name}`);
	const softened = await sharp(mask, { raw: { width, height, channels: 1 } })
		.blur(settings.blurAt2048 * factor)
		.extractChannel(0)
		.raw()
		.toBuffer();
	if (softened.length !== width * height)
		throw new Error(`Unexpected emission mask channels: ${settings.name}`);
	let renderedAlpha = 0;
	for (let index = 0; index < width * height; index++) {
		for (let channel = 0; channel < 3; channel++)
			rgba[index * 4 + channel] = settings.color[channel];
		rgba[index * 4 + 3] = Math.round(softened[index] * settings.opacity);
		renderedAlpha += rgba[index * 4 + 3];
	}
	if (!renderedAlpha)
		throw new Error(`Rendered emission is empty: ${settings.name}`);
	return {
		mask: await sharp(mask, { raw: { width, height, channels: 1 } })
			.png()
			.toBuffer(),
		layer: await sharp(rgba, { raw: { width, height, channels: 4 } })
			.png()
			.toBuffer(),
		selectedPixels,
		renderedAlpha,
	};
}

function inspectPlacement(alpha, width, height, cornerRadius) {
	const radius = width * cornerRadius;
	let minimumClearance = Infinity;
	let clippedPixels = 0;
	const bounds = { left: width, top: height, right: 0, bottom: 0 };
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (alpha[y * width + x] < 16) continue;
			const qx = Math.abs(x + 0.5 - width / 2) - (width / 2 - radius);
			const qy = Math.abs(y + 0.5 - height / 2) - (height / 2 - radius);
			const clearance =
				radius -
				(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
					Math.min(Math.max(qx, qy), 0));
			minimumClearance = Math.min(minimumClearance, clearance);
			if (clearance < 0) clippedPixels++;
			bounds.left = Math.min(bounds.left, x);
			bounds.top = Math.min(bounds.top, y);
			bounds.right = Math.max(bounds.right, x);
			bounds.bottom = Math.max(bounds.bottom, y);
		}
	}
	return {
		bounds,
		visibleAlphaThreshold: 16,
		minimumRoundedEdgeClearance: minimumClearance,
		clippedPixels,
	};
}

const runArgument = process.argv[2];
const pass = process.argv[3];
if (!runArgument || !/^\d{2}$/.test(pass ?? ""))
	throw new Error(
		"Usage: bun finish_study.mjs <study-directory> <finishing-pass: 01>",
	);
const run = path.resolve(runArgument);
const settingsBytes = await readFile(path.join(run, "presentation.json"));
const settings = JSON.parse(settingsBytes);
const retained = settings.sourceMode === "retained-transparent";
const adapted = settings.sourceMode === "prepared-transparent";
const supplied = retained || adapted;
const sourceRecordName = supplied
	? "source.json"
	: (settings.sourceRecord ?? "response.json");
const sourceRecordBytes = await readFile(path.join(run, sourceRecordName));
const sourceRecord = JSON.parse(sourceRecordBytes);
if (
	supplied
		? sourceRecord.kind !==
				(adapted ? "reference-adaptation" : "retained-original") ||
			sourceRecord.generationCalls !== 0
		: sourceRecord.status !== "succeeded"
)
	throw new Error("A recorded original or successful generation is required.");
const source = supplied ? sourceRecord.artwork : sourceRecord.output;
const reviewName = supplied ? "source-review.json" : "raw-review.json";
const reviewBytes = await readFile(path.join(run, reviewName));
const review = JSON.parse(reviewBytes);
if (review.status !== "approved" || review.imageSha256 !== source.sha256)
	throw new Error(
		"Owner approval of this exact raw image is required before finishing.",
	);
const sourceBytes = await readFile(path.join(run, source.path));
if (sha256(sourceBytes) !== source.sha256)
	throw new Error("Source artwork differs from its recorded hash.");
if (adapted) {
	const reference = sourceRecord.reference;
	if (!reference?.path || !reference.sha256)
		throw new Error("A prepared illustration requires its original reference.");
	const bytes = await readFile(path.join(run, reference.path));
	if (sha256(bytes) !== reference.sha256)
		throw new Error("Illustration reference differs from its recorded hash.");
}
const destination = path.join(run, "finishing", pass);
try {
	await stat(destination);
	throw new Error("Finishing pass already exists; use a new number.");
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
const { data: rgb, info } = await sharp(sourceBytes)
	.removeAlpha()
	.toColourspace("srgb")
	.raw()
	.toBuffer({ resolveWithObject: true });
const { width, height } = info;
if (width !== height)
	throw new Error("This icon study requires a square master.");
if (
	settings.sourceRecord &&
	(source.width !== width ||
		source.height !== height ||
		source.bytes !== sourceBytes.length)
)
	throw new Error(
		"Supplemental source dimensions or bytes differ from the native artwork.",
	);
let protection = null;
let foregroundMask = null;
let foreground;
let alpha;
let statistics;
if (supplied) {
	const metadata = await sharp(sourceBytes).metadata();
	if (!metadata.hasAlpha || metadata.format !== "png")
		throw new Error("Retained artwork must be an existing transparent PNG.");
	if (
		retained &&
		((settings.framing?.scale ?? 1) !== 1 ||
			(settings.framing?.offsetAt2048 ?? []).some((value) => value !== 0) ||
			settings.framing?.continuation)
	)
		throw new Error("A retained original cannot be repositioned or redrawn.");
	foreground = sourceBytes;
	alpha = await sharp(sourceBytes).extractChannel(3).raw().toBuffer();
	const backgroundPixels = alpha.filter((value) => value === 0).length;
	if (!backgroundPixels || !alpha.some((value) => value === 255))
		throw new Error(
			"Inspect the original: expected transparent and opaque pixels.",
		);
	statistics = {
		backgroundPixels,
		foregroundPixels: width * height - backgroundPixels,
		softEdgePixels: alpha.filter((value) => value > 0 && value < 255).length,
		foregroundByteIdentical: true,
	};
} else if (settings.matte.foregroundMask) {
	const mask = settings.matte.foregroundMask;
	foregroundMask = await readFile(path.resolve(run, mask.path));
	if (sha256(foregroundMask) !== mask.sha256)
		throw new Error("Foreground mask differs from its recorded hash.");
	const metadata = await sharp(foregroundMask).metadata();
	if (
		metadata.format !== "svg" ||
		metadata.width !== width ||
		metadata.height !== height
	)
		throw new Error(
			"Foreground mask must be a native-size SVG with a transparent backdrop.",
		);
	alpha = await sharp(foregroundMask)
		.ensureAlpha()
		.extractChannel(3)
		.raw()
		.toBuffer();
	const backgroundPixels = alpha.filter((value) => value === 0).length;
	if (!backgroundPixels || !alpha.some((value) => value === 255))
		throw new Error("Foreground mask needs transparent and opaque pixels.");
	foreground = await sharp(rgb, { raw: { width, height, channels: 3 } })
		.joinChannel(alpha, { raw: { width, height, channels: 1 } })
		.png()
		.toBuffer();
	statistics = {
		backgroundPixels,
		foregroundPixels: width * height - backgroundPixels,
		softEdgePixels: alpha.filter((value) => value > 0 && value < 255).length,
		opaqueRgbPreserved: true,
	};
} else {
	protection = await makeMatteProtection(
		width,
		height,
		settings.matte.foregroundRegionsAt2048,
	);
	const extracted = extractWhite(
		rgb,
		width,
		height,
		settings.matte,
		protection,
	);
	alpha = extracted.alpha;
	statistics = extracted.statistics;
	foreground = await sharp(extracted.rgba, {
		raw: { width, height, channels: 4 },
	})
		.png()
		.toBuffer();
}
await mkdir(path.join(destination, "exports"), { recursive: true });
await mkdir(path.join(destination, "previews"));
const files = [];
async function save(name, bytes) {
	await writeFile(path.join(destination, name), bytes);
	files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
}
await save("settings.json", settingsBytes);
await save(reviewName, reviewBytes);
if (supplied || settings.sourceRecord)
	await save(sourceRecordName, sourceRecordBytes);
if (foregroundMask) await save("foreground-mask.svg", foregroundMask);
await save("tool-snapshot.mjs", await readFile(new URL(import.meta.url)));
if (protection)
	await save(
		"matte-protection-mask.png",
		await sharp(protection, { raw: { width, height, channels: 1 } })
			.png()
			.toBuffer(),
	);
await save(
	retained ? "retained-foreground.png" : "extracted-foreground.png",
	foreground,
);
await save(
	"alpha-mask.png",
	await sharp(alpha, { raw: { width, height, channels: 1 } })
		.png()
		.toBuffer(),
);
const svg = backgroundSvg(width, settings.background);
await save("background.svg", Buffer.from(svg));
const backgroundRaw = await sharp(Buffer.from(svg))
	.removeAlpha()
	.raw()
	.toBuffer();
let noiseState = settings.background.grainSeed;
for (let index = 0; index < width * height; index++) {
	noiseState = (Math.imul(1664525, noiseState) + 1013904223) >>> 0;
	const noise =
		((noiseState / 4294967296) * 2 - 1) * settings.background.grainAmplitude;
	for (let channel = 0; channel < 3; channel++) {
		const offset = index * 3 + channel;
		backgroundRaw[offset] = Math.max(
			0,
			Math.min(255, Math.round(backgroundRaw[offset] + noise)),
		);
	}
}
const background = await sharp(backgroundRaw, {
	raw: { width, height, channels: 3 },
})
	.png()
	.toBuffer();
await save("background.png", background);
const placementScale = settings.framing?.scale ?? 1;
if (
	!Number.isFinite(placementScale) ||
	placementScale < 0.5 ||
	placementScale > 1
)
	throw new Error("Foreground placement scale must be between 0.5 and 1.");
let placedForeground = await placeLayer(
	foreground,
	width,
	height,
	settings.framing,
);
let continuationReport = null;
const continuation = settings.framing?.continuation;
if (continuation) {
	const bytes = await readFile(path.resolve(run, continuation.path));
	if (sha256(bytes) !== continuation.sha256)
		throw new Error("Edge continuation differs from its recorded hash.");
	const metadata = await sharp(bytes).metadata();
	if (
		metadata.format !== "svg" ||
		metadata.width !== 2048 ||
		metadata.height !== 2048
	)
		throw new Error(
			"Edge continuation must be a native 2048-square SVG layer.",
		);
	const layer = await sharp(bytes).resize(width, height).png().toBuffer();
	await save("edge-continuation.svg", bytes);
	await save("edge-continuation.png", layer);
	await save("placed-source.png", placedForeground);
	const sourcePixels = await sharp(placedForeground)
		.ensureAlpha()
		.raw()
		.toBuffer();
	placedForeground = await sharp(layer)
		.composite([{ input: placedForeground }])
		.png()
		.toBuffer();
	const finishedPixels = await sharp(placedForeground)
		.ensureAlpha()
		.raw()
		.toBuffer();
	let addedPixels = 0;
	let opaquePixelsPreserved = 0;
	for (let index = 0; index < width * height; index++) {
		const at = index * 4;
		if (sourcePixels[at + 3] === 255) {
			if (
				!sourcePixels
					.subarray(at, at + 4)
					.equals(finishedPixels.subarray(at, at + 4))
			)
				throw new Error("Edge continuation changed an opaque approved pixel.");
			opaquePixelsPreserved++;
		}
		if (sourcePixels[at + 3] === 0 && finishedPixels[at + 3] >= 16)
			addedPixels++;
	}
	if (!addedPixels)
		throw new Error("Edge continuation adds no visible contour.");
	continuationReport = {
		path: continuation.path,
		sha256: continuation.sha256,
		description: continuation.description,
		addedPixels,
		opaquePixelsPreserved,
	};
}
const placementChanged =
	placementScale !== 1 ||
	(settings.framing?.offsetAt2048 ?? []).some((value) => value !== 0) ||
	Boolean(continuation);
const presentationAlpha = placementChanged
	? await sharp(placedForeground).extractChannel(3).raw().toBuffer()
	: alpha;
const placement = inspectPlacement(
	presentationAlpha,
	width,
	height,
	settings.cornerRadius,
);
const requiredClearance = settings.framing?.minimumClearanceAt2048;
if (
	requiredClearance !== undefined &&
	placement.minimumRoundedEdgeClearance < (requiredClearance * width) / 2048
)
	throw new Error(
		`Insufficient rounded-corner clearance: ${placement.minimumRoundedEdgeClearance.toFixed(1)} pixels`,
	);
if (placementChanged) {
	await save("foreground-placement.png", placedForeground);
	await save(
		"presentation-alpha-mask.png",
		await sharp(presentationAlpha, {
			raw: { width, height, channels: 1 },
		})
			.png()
			.toBuffer(),
	);
}
const shadows = [];
for (const [index, shadow] of settings.shadows.entries()) {
	const bytes = await makeShadow(presentationAlpha, width, height, shadow);
	await save(`shadow-${index + 1}.png`, bytes);
	shadows.push({ input: bytes });
}
const emissions = [];
const emissionReports = [];
for (const light of settings.emission ?? []) {
	if (!/^[a-z0-9-]+$/.test(light.name))
		throw new Error("Emission names must be lowercase filename-safe labels.");
	const result = await makeEmission(rgb, alpha, width, height, light);
	const layer = await placeLayer(result.layer, width, height, settings.framing);
	await save(`glow-${light.name}-mask.png`, result.mask);
	await save(`glow-${light.name}.png`, layer);
	emissions.push({ input: layer, blend: light.blend });
	emissionReports.push({
		name: light.name,
		selectedPixels: result.selectedPixels,
		renderedAlpha: result.renderedAlpha,
		maskCoordinates: "Native source pixels, before icon placement",
	});
}
const square = await sharp(background)
	.composite([...shadows, ...emissions, { input: placedForeground }])
	.png()
	.toBuffer();
const roundedMask = Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${width * settings.cornerRadius}" fill="white"/></svg>`,
);
const rounded = await sharp(square)
	.composite([{ input: roundedMask, blend: "dest-in" }])
	.png()
	.toBuffer();
for (const size of settings.exportSizes) {
	if (size > width && !settings.upscaledExportSizes?.includes(size))
		throw new Error(
			"Upscaled exports require an explicit upscaledExportSizes declaration.",
		);
	for (const [kind, bytes] of [
		["transparent", placedForeground],
		["icon", square],
		["rounded", rounded],
	]) {
		const output =
			size === width
				? bytes
				: await sharp(bytes).resize(size, size).png().toBuffer();
		await save(`exports/${settings.project}-${kind}-${size}.png`, output);
	}
}
await save(
	`exports/${settings.project}-white-${width}.png`,
	await sharp(placedForeground)
		.flatten({ background: "#ffffff" })
		.png()
		.toBuffer(),
);
for (const [name, color] of [
	["light", "#f6f5ef"],
	["dark", "#17211d"],
]) {
	await save(
		`previews/on-${name}-1024.png`,
		await sharp(placedForeground)
			.flatten({ background: color })
			.resize(1024, 1024)
			.png()
			.toBuffer(),
	);
}
await save(
	"manifest.json",
	Buffer.from(
		`${JSON.stringify(
			{
				createdAt: new Date().toISOString(),
				pass,
				tool: "artwork/logo-family/tools/finish_study.mjs",
				toolSha256: sha256(await readFile(new URL(import.meta.url))),
				sharp: sharp.versions.sharp,
				input: {
					path: `../../${source.path}`,
					sha256: sha256(sourceBytes),
					width,
					height,
				},
				method: adapted
					? "Transparent illustration prepared from an archived supplied reference. Native extraction and its derivation are recorded in source.json; uniform placement and explicit upscale exports do not add native detail. Background and shadow layers are separate."
					: retained
						? "Original transparent PNG retained byte-for-byte at native dimensions. Background, grain, and contact shadows are independent layers. No model request, extraction, recoloring, or reframing."
						: foregroundMask
							? "Inspected native SVG silhouette extraction with antialiased alpha; opaque source RGB is unchanged. Enclosed holes and exterior shadows follow the recorded contour, not a global white threshold. Background and new shadows remain separate."
							: "Border-connected near-white extraction with optional recorded interior background seeds and pale-anatomy protection; recipe-specific edge alpha matting and color decontamination. No global white deletion. Whole-group placement is recorded separately.",
				...(settings.sourceRecord ? { sourceRecord: sourceRecordName } : {}),
				...(settings.exportSizes.some((size) => size > width)
					? {
							upscaledExportSizes: settings.exportSizes.filter(
								(size) => size > width,
							),
						}
					: {}),
				...(retained
					? {
							generationCalls: 0,
							upscaledExportSizes: settings.exportSizes.filter(
								(size) => size > width,
							),
						}
					: {}),
				settings,
				statistics,
				placement: {
					scale: placementScale,
					offsetAt2048: settings.framing?.offsetAt2048 ?? [0, 0],
					...placement,
				},
				emission: emissionReports,
				...(continuationReport ? { continuation: continuationReport } : {}),
				files,
			},
			null,
			"\t",
		)}\n`,
	),
);
console.log(
	JSON.stringify(
		{
			destination,
			dimensions: [width, height],
			statistics,
			files: files.length,
		},
		null,
		2,
	),
);
