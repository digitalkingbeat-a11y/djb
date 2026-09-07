const { expect } = require('chai');
const analyzer = require('../audio_analyzer_ffmpeg');

function clickSamples(bpm, durationSec = 8, sampleRate = 44100){
  const beatSecs = 60 / bpm;
  const samples = new Float32Array(durationSec * sampleRate);
  for(let n = 0; n < samples.length; n++){
    const t = n / sampleRate;
    const near = Math.abs((t / beatSecs) - Math.round(t / beatSecs));
    const click = near < (1 / sampleRate) * 3 / beatSecs ? 0.92 : 0;
    const sine = Math.sin(2 * Math.PI * 440 * t) * 0.024;
    samples[n] = Math.max(-1, Math.min(1, click + sine));
  }
  return samples;
}

describe('Audio analyzer deterministic units', () => {
  it('converts signed 16-bit PCM samples into normalized floats', () => {
    const pcm = Buffer.alloc(6);
    pcm.writeInt16LE(-32768, 0);
    pcm.writeInt16LE(0, 2);
    pcm.writeInt16LE(32767, 4);

    const samples = analyzer.s16leToFloat32(pcm);
    expect(Array.from(samples)).to.deep.equal([-1, 0, 32767 / 32768]);
  });

  it('computes RMS and slices sample windows deterministically', () => {
    const samples = Float32Array.from([0, 1, -1, 1, -1, 0]);
    expect(analyzer.rms(samples)).to.be.closeTo(Math.sqrt(4 / 6), 0.000001);

    const segment = analyzer.sliceSegment(samples, 2, 1, 1);
    expect(Array.from(segment)).to.deep.equal([1, -1]);
  });

  it('computes spectrum and band energy without requiring FFmpeg', () => {
    const samples = new Float32Array(2048);
    samples.fill(1);
    const spectrum = analyzer.computeSpectrum(samples, 44100);
    expect(spectrum[0].mag).to.be.greaterThan(2000);
    expect(analyzer.bandEnergy(spectrum, 20, 250)).to.be.lessThan(0.01);
  });

  it('detects click-track onsets with minimum peak spacing', () => {
    const samples = clickSamples(123, 8);
    const onsets = analyzer.detectOnsets(samples, 44100);
    expect(onsets.length).to.be.within(15, 18);
    for(let i = 1; i < onsets.length; i++){
      expect(onsets[i] - onsets[i - 1]).to.be.at.least(0.24);
    }
  });

  [80, 100, 123, 128, 140, 174].forEach(bpm => {
    it(`estimates ${bpm} BPM from synthetic decoded click samples`, () => {
      const samples = clickSamples(bpm, 8);
      const onsets = analyzer.detectOnsets(samples, 44100);
      const estimated = analyzer.estimateTempoBpm(onsets);
      expect(estimated).to.be.closeTo(bpm, 3);
      const res = analyzer.analyzeDecodedAudio({ samples, events: onsets.map(actualSec => ({ actualSec })) });
      expect(res.session.bpm).to.be.closeTo(bpm, 3);
      expect(res.session.onsets.length).to.equal(onsets.length);
    });
  });

  it('normalizes double and triple tempo candidates into the supported BPM range', () => {
    const tripleTempoOnsets = [0, 0.18, 0.36, 0.54, 0.72, 0.90, 1.08];
    const estimated = analyzer.estimateTempoBpm(tripleTempoOnsets);
    expect(estimated).to.be.within(108, 113);
  });

  it('rejects extraction before spawning when FFmpeg is unavailable', async () => {
    const missingRoot = 'Z:\\definitely-missing-ffmpeg';
    try{
      await analyzer.extractPcmBuffer('mix.wav', {
        env: { FFMPEG_PATH: missingRoot, PATH: '' },
        bundledRoot: missingRoot,
        fsImpl: { statSync(){ throw new Error('missing'); }, readdirSync(){ throw new Error('missing'); } },
        platform: 'win32'
      });
      throw new Error('expected unavailable error');
    }catch(err){
      expect(err.code).to.equal('FFMPEG_UNAVAILABLE');
      expect(err.message).to.equal('FFmpeg is unavailable. Set FFMPEG_PATH or install FFmpeg.');
      expect(JSON.stringify(err.capability)).to.not.include(missingRoot);
    }
  });
});
