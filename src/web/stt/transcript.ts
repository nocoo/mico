export interface LessonClip {
	id: string
	lang: string
	subject: string
	title: string
	voice: string
	script: string
	rate: string
	audio: string
	duration: number
}

const MAX_OVERLAP = 80

export function dedupeHypothesis(confirmed: string, hypothesis: string): string {
	if (!confirmed || !hypothesis) return hypothesis
	const limit = Math.min(confirmed.length, hypothesis.length, MAX_OVERLAP)
	for (let length = limit; length > 0; length--) {
		if (confirmed.endsWith(hypothesis.slice(0, length))) return hypothesis.slice(length)
	}
	return hypothesis
}

export function formatClock(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds))
	return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function lectureSegmentText(
	clip: Pick<LessonClip, 'subject' | 'title'>,
	index: number,
	start: number,
	end: number,
	text: string,
): string {
	return `[Lecture | ${clip.subject} · ${clip.title} | segment ${index} | ${formatClock(start)}–${formatClock(end)}] ${text}`
}

export function isWaitReply(text: string): boolean {
	return /^wait[.!。]?$/i.test(text.trim())
}
