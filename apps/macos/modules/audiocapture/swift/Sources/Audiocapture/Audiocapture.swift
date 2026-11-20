import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

func makeEngine() throws -> any Engine {
    NativeEngine()
}

final class NativeEngine: Engine {
    func listDevices() throws -> [InputDevice] {
        SystemAudioInputs.devices()
    }

    func probeScreenCapture() async throws -> ProbeResult {
        await ScreenCaptureProbe.check(timeoutSeconds: 6)
    }

    func stream(deviceID: String) -> AsyncThrowingStream<NativeBuffer, Error> {
        AsyncThrowingStream { continuation in
            let session = CaptureSession(deviceID: deviceID, continuation: continuation)
            continuation.onTermination = { _ in
                session.stop()
            }
            session.start()
        }
    }
}

private enum ScreenCaptureProbe {
    static func check(timeoutSeconds: UInt64) async -> ProbeResult {
        await withCheckedContinuation { continuation in
            let lock = NSLock()
            var finished = false
            func finish(_ result: ProbeResult) {
                lock.lock()
                defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                continuation.resume(returning: result)
            }

            let timeout = DispatchWorkItem {
                finish(ProbeResult(
                    status: .probeUnavailable,
                    detail: "macOS did not respond to the system audio check. Try again."
                ))
            }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(
                deadline: .now() + .seconds(Int(timeoutSeconds)),
                execute: timeout
            )

            SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
                timeout.cancel()
                if let error {
                    finish(result(for: error))
                } else if content != nil {
                    finish(ProbeResult(status: .probeGranted, detail: ""))
                } else {
                    finish(ProbeResult(
                        status: .probeUnavailable,
                        detail: "macOS returned no capture information."
                    ))
                }
            }
        }
    }

    static func result(for error: Error) -> ProbeResult {
        let nsError = error as NSError
        if nsError.domain == SCStreamErrorDomain && nsError.code == SCStreamError.userDeclined.rawValue {
            return ProbeResult(status: .probeDenied, detail: nsError.localizedDescription)
        }
        return ProbeResult(status: .probeUnavailable, detail: nsError.localizedDescription)
    }
}

private final class CaptureSession: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let deviceID: String
    private let continuation: AsyncThrowingStream<NativeBuffer, Error>.Continuation
    private let sampleQueue = DispatchQueue(
        label: "com.nocoo.mico.helper.audio.samples",
        qos: .userInitiated
    )
    private let pool = NativeBufferPool(size: DualStreamPcmMixer.frameBytes)
    private let mixer = DualStreamPcmMixer()
    private let stateLock = NSLock()

    private var stream: SCStream?
    private var drainTimer: DispatchSourceTimer?
    private var stopped = false

    init(deviceID: String, continuation: AsyncThrowingStream<NativeBuffer, Error>.Continuation) {
        self.deviceID = deviceID
        self.continuation = continuation
    }

    func start() {
        Task {
            do {
                let content = try await SCShareableContent.current
                guard let display = content.displays.first else {
                    fail(AudiocaptureError.noDisplay)
                    return
                }

                let filter = SCContentFilter(
                    display: display,
                    excludingApplications: [],
                    exceptingWindows: []
                )
                let config = SCStreamConfiguration()
                config.width = 2
                config.height = 2
                config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                config.capturesAudio = true
                config.sampleRate = 48000
                config.channelCount = 2

                if let effectiveMicID = SystemAudioInputs.resolveEffectiveDeviceID(preferred: deviceID) {
                    config.captureMicrophone = true
                    config.microphoneCaptureDeviceID = effectiveMicID
                } else {
                    config.captureMicrophone = false
                }

                let scStream = SCStream(filter: filter, configuration: config, delegate: self)
                try scStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
                if config.captureMicrophone {
                    try scStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue)
                }

                stateLock.lock()
                if stopped {
                    stateLock.unlock()
                    return
                }
                self.stream = scStream
                stateLock.unlock()

                try await scStream.startCapture()
                armDrainTimer()
            } catch {
                let nsError = error as NSError
                if nsError.domain == SCStreamErrorDomain && nsError.code == SCStreamError.userDeclined.rawValue {
                    fail(AudiocaptureError.permissionDenied)
                } else {
                    fail(error)
                }
            }
        }
    }

    func stop() {
        stateLock.lock()
        if stopped {
            stateLock.unlock()
            return
        }
        stopped = true
        let activeStream = stream
        stream = nil
        let timer = drainTimer
        drainTimer = nil
        stateLock.unlock()

        timer?.cancel()

        Task {
            if let activeStream {
                try? await activeStream.stopCapture()
            }
            sampleQueue.async { [weak self] in
                guard let self else { return }
                let tailFrames = self.mixer.flushFrames()
                for frame in tailFrames {
                    self.emit(frame: frame)
                }
                self.continuation.finish()
            }
        }
    }

    private func fail(_ error: Error) {
        stateLock.lock()
        if stopped {
            stateLock.unlock()
            return
        }
        stopped = true
        let activeStream = stream
        stream = nil
        let timer = drainTimer
        drainTimer = nil
        stateLock.unlock()

        timer?.cancel()
        if let activeStream {
            Task { try? await activeStream.stopCapture() }
        }
        continuation.finish(throwing: error)
    }

    private func armDrainTimer() {
        sampleQueue.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let alreadyStopped = self.stopped
            self.stateLock.unlock()
            guard !alreadyStopped else { return }

            let timer = DispatchSource.makeTimerSource(queue: self.sampleQueue)
            timer.schedule(deadline: .now() + .milliseconds(25), repeating: .milliseconds(25))
            timer.setEventHandler { [weak self] in
                guard let self else { return }
                let frames = self.mixer.drainFrames()
                for frame in frames {
                    self.emit(frame: frame)
                }
            }
            self.stateLock.lock()
            if self.stopped {
                self.stateLock.unlock()
                timer.cancel()
                return
            }
            self.drainTimer = timer
            self.stateLock.unlock()
            timer.resume()
        }
    }

    private func emit(frame: [Int16]) {
        guard !frame.isEmpty else { return }
        let byteCount = frame.count * MemoryLayout<Int16>.size
        let buf: NativeBuffer
        if byteCount == DualStreamPcmMixer.frameBytes {
            buf = pool.get()
        } else {
            buf = NativeBuffer(count: byteCount)
        }
        guard let dst = buf.bytes.baseAddress else { return }
        let out = dst.bindMemory(to: UInt8.self, capacity: byteCount)
        for i in 0..<frame.count {
            let le = frame[i].littleEndian
            out[i * 2] = UInt8(truncatingIfNeeded: le)
            out[i * 2 + 1] = UInt8(truncatingIfNeeded: le >> 8)
        }
        continuation.yield(buf)
    }

    // MARK: - SCStreamOutput

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid else { return }
        guard outputType == .audio || outputType == .microphone else { return }
        guard let extracted = Self.extractMonoFloatSamples(from: sampleBuffer) else { return }

        if outputType == .audio {
            mixer.pushSystem(extracted.samples, sampleRate: extracted.sampleRate)
        } else {
            mixer.pushMicrophone(extracted.samples, sampleRate: extracted.sampleRate)
        }

        let frames = mixer.drainFrames()
        for frame in frames {
            emit(frame: frame)
        }
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        let nsError = error as NSError
        if nsError.domain == SCStreamErrorDomain && nsError.code == SCStreamError.userDeclined.rawValue {
            fail(AudiocaptureError.permissionDenied)
        } else {
            fail(error)
        }
    }

    // MARK: - PCM Extraction (supports planar and interleaved Float32 / Int16)

    private static func extractMonoFloatSamples(
        from sampleBuffer: CMSampleBuffer
    ) -> (samples: [Float], sampleRate: Double)? {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            return nil
        }
        let asbd = asbdPtr.pointee
        let sampleRate = asbd.mSampleRate > 0 ? asbd.mSampleRate : 48000
        let channels = max(1, Int(asbd.mChannelsPerFrame))
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let bitsPerChannel = Int(asbd.mBitsPerChannel)

        var listSizeNeeded = 0
        let sizeStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &listSizeNeeded,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )
        guard sizeStatus == noErr || sizeStatus == kCMSampleBufferError_BufferNotReady || listSizeNeeded > 0 else {
            return nil
        }
        let allocSize = max(listSizeNeeded, MemoryLayout<AudioBufferList>.size)
        let rawList = UnsafeMutableRawPointer.allocate(
            byteCount: allocSize,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { rawList.deallocate() }
        let audioBufferListPtr = rawList.bindMemory(to: AudioBufferList.self, capacity: 1)

        var blockBuffer: CMBlockBuffer?
        let fillStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferListPtr,
            bufferListSize: allocSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard fillStatus == noErr else { return nil }

        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferListPtr)
        guard !buffers.isEmpty else { return nil }

        if isFloat && bitsPerChannel == 32 {
            if isNonInterleaved && buffers.count >= channels {
                guard let firstData = buffers[0].mData else { return nil }
                let frameCount = Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size
                guard frameCount > 0 else { return nil }
                if channels == 1 {
                    let ptr = firstData.bindMemory(to: Float.self, capacity: frameCount)
                    return (Array(UnsafeBufferPointer(start: ptr, count: frameCount)), sampleRate)
                }
                var channelPtrs: [UnsafeBufferPointer<Float>] = []
                for ch in 0..<channels {
                    guard let data = buffers[ch].mData else { continue }
                    let count = min(frameCount, Int(buffers[ch].mDataByteSize) / MemoryLayout<Float>.size)
                    channelPtrs.append(UnsafeBufferPointer(start: data.bindMemory(to: Float.self, capacity: count), count: count))
                }
                guard !channelPtrs.isEmpty else { return nil }
                let safeFrames = channelPtrs.map(\.count).min() ?? 0
                var mono = [Float](repeating: 0, count: safeFrames)
                for f in 0..<safeFrames {
                    var best: Float = 0
                    var bestAbs: Float = 0
                    for chBuf in channelPtrs {
                        let v = chBuf[f]
                        let av = abs(v)
                        if av > bestAbs {
                            best = v
                            bestAbs = av
                        }
                    }
                    mono[f] = best
                }
                return (mono, sampleRate)
            } else {
                guard let data = buffers[0].mData else { return nil }
                let totalFloats = Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size
                guard totalFloats > 0 else { return nil }
                let floats = UnsafeBufferPointer(start: data.bindMemory(to: Float.self, capacity: totalFloats), count: totalFloats)
                if channels == 1 {
                    return (Array(floats), sampleRate)
                }
                let frameCount = totalFloats / channels
                var mono = [Float](repeating: 0, count: frameCount)
                for f in 0..<frameCount {
                    var best: Float = 0
                    var bestAbs: Float = 0
                    for ch in 0..<channels {
                        let v = floats[f * channels + ch]
                        let av = abs(v)
                        if av > bestAbs {
                            best = v
                            bestAbs = av
                        }
                    }
                    mono[f] = best
                }
                return (mono, sampleRate)
            }
        }

        if !isFloat && bitsPerChannel == 16 {
            let scale: Float = 1.0 / 32768.0
            guard let data = buffers[0].mData else { return nil }
            let total = Int(buffers[0].mDataByteSize) / MemoryLayout<Int16>.size
            guard total > 0 else { return nil }
            let ints = UnsafeBufferPointer(start: data.bindMemory(to: Int16.self, capacity: total), count: total)
            if channels == 1 || isNonInterleaved {
                return (ints.map { Float($0) * scale }, sampleRate)
            }
            let frameCount = total / channels
            var mono = [Float](repeating: 0, count: frameCount)
            for f in 0..<frameCount {
                var best: Float = 0
                var bestAbs: Float = 0
                for ch in 0..<channels {
                    let v = Float(ints[f * channels + ch]) * scale
                    let av = abs(v)
                    if av > bestAbs {
                        best = v
                        bestAbs = av
                    }
                }
                mono[f] = best
            }
            return (mono, sampleRate)
        }

        return nil
    }
}
