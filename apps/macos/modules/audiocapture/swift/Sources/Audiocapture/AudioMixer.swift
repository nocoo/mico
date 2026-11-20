import Foundation

final class LinearResampler {
    private let targetRate: Double
    private var sourceRate: Double
    private var carry: [Float] = []
    private var position: Double = 0

    init(sourceRate: Double, targetRate: Double = 16000) {
        self.sourceRate = sourceRate > 0 ? sourceRate : targetRate
        self.targetRate = targetRate
    }

    func push(_ samples: [Float], sampleRate: Double) -> [Float] {
        guard !samples.isEmpty else { return [] }
        let rate = sampleRate > 0 ? sampleRate : sourceRate
        if abs(rate - sourceRate) > 1.0 {
            sourceRate = rate
            carry.removeAll(keepingCapacity: true)
            position = 0
        }
        if abs(sourceRate - targetRate) < 1.0 {
            return samples
        }

        carry.append(contentsOf: samples)
        let ratio = sourceRate / targetRate
        var out: [Float] = []
        out.reserveCapacity(Int(Double(carry.count) / ratio) + 1)

        while true {
            let idx = Int(position)
            if idx + 1 >= carry.count {
                break
            }
            let frac = Float(position - Double(idx))
            let s0 = carry[idx]
            let s1 = carry[idx + 1]
            out.append(s0 + (s1 - s0) * frac)
            position += ratio
        }

        let consumed = Int(position)
        if consumed > 0 && consumed <= carry.count {
            carry.removeFirst(consumed)
            position -= Double(consumed)
        }
        return out
    }

    func flush() -> [Float] {
        defer {
            carry.removeAll(keepingCapacity: false)
            position = 0
        }
        guard !carry.isEmpty else { return [] }
        if abs(sourceRate - targetRate) < 1.0 {
            return carry
        }
        let ratio = sourceRate / targetRate
        var out: [Float] = []
        while Int(position) < carry.count {
            let idx = Int(position)
            let next = min(idx + 1, carry.count - 1)
            let frac = Float(position - Double(idx))
            out.append(carry[idx] + (carry[next] - carry[idx]) * frac)
            position += ratio
        }
        return out
    }
}

final class DualStreamPcmMixer {
    static let targetRate: Double = 16000
    static let frameSamples: Int = 1600
    static let frameBytes: Int = frameSamples * 2
    /// ~180ms at 16kHz mono before draining a single active track.
    static let singleSourceDrainThreshold: Int = 2880
    /// 5 seconds cap per source buffer at 16kHz.
    static let maxBufferSamples: Int = 80_000

    private let micGain: Float = 2.2
    private let systemGain: Float = 0.85

    private let sysResampler = LinearResampler(sourceRate: 48000, targetRate: targetRate)
    private let micResampler = LinearResampler(sourceRate: 48000, targetRate: targetRate)

    private var systemBuffer: [Float] = []
    private var micBuffer: [Float] = []
    private var pcmCarry: [Int16] = []

    func pushSystem(_ samples: [Float], sampleRate: Double) {
        let resampled = sysResampler.push(Self.sanitize(samples), sampleRate: sampleRate)
        guard !resampled.isEmpty else { return }
        systemBuffer.append(contentsOf: resampled)
        capBuffer(&systemBuffer)
    }

    func pushMicrophone(_ samples: [Float], sampleRate: Double) {
        let resampled = micResampler.push(Self.sanitize(samples), sampleRate: sampleRate)
        guard !resampled.isEmpty else { return }
        micBuffer.append(contentsOf: resampled)
        capBuffer(&micBuffer)
    }

    func drainFrames() -> [[Int16]] {
        let mixed = drainMixedSamples()
        appendPcm(mixed)
        var frames: [[Int16]] = []
        while pcmCarry.count >= Self.frameSamples {
            frames.append(Array(pcmCarry.prefix(Self.frameSamples)))
            pcmCarry.removeFirst(Self.frameSamples)
        }
        return frames
    }

    func flushFrames() -> [[Int16]] {
        let sysTail = sysResampler.flush()
        if !sysTail.isEmpty {
            systemBuffer.append(contentsOf: sysTail)
        }
        let micTail = micResampler.flush()
        if !micTail.isEmpty {
            micBuffer.append(contentsOf: micTail)
        }
        let mixed = flushMixedSamples()
        appendPcm(mixed)
        var frames: [[Int16]] = []
        while pcmCarry.count >= Self.frameSamples {
            frames.append(Array(pcmCarry.prefix(Self.frameSamples)))
            pcmCarry.removeFirst(Self.frameSamples)
        }
        if !pcmCarry.isEmpty {
            frames.append(pcmCarry)
            pcmCarry.removeAll()
        }
        return frames
    }

    private func appendPcm(_ floats: [Float]) {
        guard !floats.isEmpty else { return }
        pcmCarry.reserveCapacity(pcmCarry.count + floats.count)
        for sample in floats {
            let clamped = max(-1.0, min(1.0, sample))
            let scaled = clamped < 0 ? clamped * 32768.0 : clamped * 32767.0
            pcmCarry.append(Int16(max(-32768.0, min(32767.0, scaled.rounded()))))
        }
    }

    private func drainMixedSamples() -> [Float] {
        let sysCount = systemBuffer.count
        let micCount = micBuffer.count
        if sysCount > 0 && micCount > 0 {
            let n = min(sysCount, micCount)
            var out = [Float](repeating: 0, count: n)
            for i in 0..<n {
                out[i] = tanhf(systemBuffer[i] * systemGain + micBuffer[i] * micGain)
            }
            systemBuffer.removeFirst(n)
            micBuffer.removeFirst(n)
            return out
        }
        if sysCount >= Self.singleSourceDrainThreshold && micCount == 0 {
            let out = systemBuffer.map { tanhf($0 * systemGain) }
            systemBuffer.removeAll(keepingCapacity: true)
            return out
        }
        if micCount >= Self.singleSourceDrainThreshold && sysCount == 0 {
            let out = micBuffer.map { tanhf($0 * micGain) }
            micBuffer.removeAll(keepingCapacity: true)
            return out
        }
        return []
    }

    private func flushMixedSamples() -> [Float] {
        let sysCount = systemBuffer.count
        let micCount = micBuffer.count
        if sysCount > 0 && micCount > 0 {
            let overlap = min(sysCount, micCount)
            var out = [Float](repeating: 0, count: max(sysCount, micCount))
            for i in 0..<overlap {
                out[i] = tanhf(systemBuffer[i] * systemGain + micBuffer[i] * micGain)
            }
            if sysCount > micCount {
                for i in overlap..<sysCount {
                    out[i] = tanhf(systemBuffer[i] * systemGain)
                }
            } else if micCount > sysCount {
                for i in overlap..<micCount {
                    out[i] = tanhf(micBuffer[i] * micGain)
                }
            }
            systemBuffer.removeAll()
            micBuffer.removeAll()
            return out
        }
        if sysCount > 0 {
            let out = systemBuffer.map { tanhf($0 * systemGain) }
            systemBuffer.removeAll()
            return out
        }
        if micCount > 0 {
            let out = micBuffer.map { tanhf($0 * micGain) }
            micBuffer.removeAll()
            return out
        }
        return []
    }

    private func capBuffer(_ buffer: inout [Float]) {
        let overflow = buffer.count - Self.maxBufferSamples
        if overflow > 0 {
            buffer.removeFirst(overflow)
        }
    }

    private static func sanitize(_ samples: [Float]) -> [Float] {
        samples.map { value in
            guard value.isFinite else { return 0 }
            return max(-1.0, min(1.0, value))
        }
    }
}
