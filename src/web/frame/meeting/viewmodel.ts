export interface MeetingParticipant {
	name: string
	initial: string
	color: 'grape' | 'sky' | 'peach' | 'mint' | 'lemon'
}

export interface MeetingViewModel {
	title: string
	detail: string
	elapsed: string
	participants: readonly MeetingParticipant[]
	controlsEnabled: boolean
}

export function meetingPreview(): MeetingViewModel {
	return {
		title: 'Meeting preview',
		detail: 'Demo · no meeting connected',
		elapsed: '0:00',
		participants: [
			{ name: 'Participant 1', initial: 'A', color: 'grape' },
			{ name: 'Participant 2', initial: 'B', color: 'sky' },
			{ name: 'Participant 3', initial: 'C', color: 'peach' },
			{ name: 'Participant 4', initial: 'D', color: 'mint' },
			{ name: 'You', initial: 'Y', color: 'lemon' },
		],
		controlsEnabled: false,
	}
}
