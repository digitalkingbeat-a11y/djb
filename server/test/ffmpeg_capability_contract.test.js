const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  getFFmpegCapability,
  publicFFmpegCapabilityStatus
} = require('../ffmpeg_capability');

const processTelemetrySource = fs.readFileSync(path.join(__dirname, '..', 'process_telemetry.js'), 'utf8');
const gradeBeltSource = fs.readFileSync(path.join(__dirname, '..', 'grade_belt_tests.js'), 'utf8');

function dirent(name, type){
  return {
    name,
    isFile(){ return type === 'file'; },
    isDirectory(){ return type === 'dir'; }
  };
}

function mockFs({ files = [], dirs = [], entries = {} } = {}){
  const fileSet = new Set(files.map(file => path.resolve(file).toLowerCase()));
  const dirSet = new Set(dirs.map(dir => path.resolve(dir).toLowerCase()));
  const entryMap = new Map(Object.entries(entries).map(([dir, list]) => [path.resolve(dir).toLowerCase(), list]));
  return {
    constants: fs.constants,
    accessSync(){},
    statSync(filePath){
      const key = path.resolve(filePath).toLowerCase();
      if(fileSet.has(key)) return { isFile: () => true, isDirectory: () => false };
      if(dirSet.has(key)) return { isFile: () => false, isDirectory: () => true };
      throw new Error('ENOENT');
    },
    readdirSync(dirPath){
      const key = path.resolve(dirPath).toLowerCase();
      if(!entryMap.has(key)) throw new Error('ENOENT');
      return entryMap.get(key);
    }
  };
}

describe('FFmpeg capability contract', () => {
  it('supports FFMPEG_PATH as an executable path and redacts paths from public status', () => {
    const exe = path.join(process.cwd(), 'tools', 'ffmpeg.exe');
    const capability = getFFmpegCapability({
      env: { FFMPEG_PATH: exe, PATH: '' },
      fsImpl: mockFs({ files: [exe] }),
      bundledRoot: path.join(process.cwd(), 'missing-bundled'),
      platform: 'win32'
    });

    expect(capability.available).to.equal(true);
    expect(capability.source).to.equal('env');
    expect(capability.executablePath).to.equal(path.resolve(exe));

    const publicStatus = publicFFmpegCapabilityStatus(capability);
    expect(publicStatus).to.deep.equal({
      available: true,
      source: 'env',
      reason: null,
      message: 'FFmpeg is available.'
    });
    expect(JSON.stringify(publicStatus)).to.not.include(exe);
  });

  it('supports FFMPEG_PATH as a directory containing bin/ffmpeg.exe', () => {
    const root = path.join(process.cwd(), 'ffmpeg-root');
    const exe = path.join(root, 'bin', 'ffmpeg.exe');
    const capability = getFFmpegCapability({
      env: { FFMPEG_PATH: root, PATH: '' },
      fsImpl: mockFs({ files: [exe], dirs: [root] }),
      bundledRoot: path.join(process.cwd(), 'missing-bundled'),
      platform: 'win32'
    });

    expect(capability.available).to.equal(true);
    expect(capability.source).to.equal('env');
    expect(capability.executablePath).to.equal(path.resolve(exe));
  });

  it('detects a bundled executable below server/bin/ffmpeg safely', () => {
    const root = path.join(process.cwd(), 'server', 'bin', 'ffmpeg');
    const build = path.join(root, 'ffmpeg-build');
    const bin = path.join(build, 'bin');
    const exe = path.join(bin, 'ffmpeg.exe');
    const capability = getFFmpegCapability({
      env: { PATH: '' },
      fsImpl: mockFs({
        files: [exe],
        dirs: [root, build, bin],
        entries: {
          [root]: [dirent('ffmpeg-build', 'dir')],
          [build]: [dirent('bin', 'dir')],
          [bin]: [dirent('ffmpeg.exe', 'file')]
        }
      }),
      bundledRoot: root,
      platform: 'win32'
    });

    expect(capability.available).to.equal(true);
    expect(capability.source).to.equal('bundled');
  });

  it('detects ffmpeg on PATH and reports safe unavailable status otherwise', () => {
    const pathDir = path.join(process.cwd(), 'path-bin');
    const exe = path.join(pathDir, 'ffmpeg.exe');
    const capability = getFFmpegCapability({
      env: { PATH: pathDir },
      fsImpl: mockFs({ files: [exe], dirs: [pathDir] }),
      bundledRoot: path.join(process.cwd(), 'missing-bundled'),
      platform: 'win32'
    });
    expect(capability.available).to.equal(true);
    expect(capability.source).to.equal('path');

    const missing = getFFmpegCapability({
      env: { FFMPEG_PATH: path.join(process.cwd(), 'missing.exe'), PATH: '' },
      fsImpl: mockFs(),
      bundledRoot: path.join(process.cwd(), 'missing-bundled'),
      platform: 'win32'
    });
    expect(missing.available).to.equal(false);
    expect(publicFFmpegCapabilityStatus(missing)).to.deep.equal({
      available: false,
      source: null,
      reason: 'configured_path_unavailable',
      message: 'FFmpeg is unavailable. Set FFMPEG_PATH or install FFmpeg.'
    });
  });

  it('prevents worker audio analysis startup when capability is unavailable', () => {
    [processTelemetrySource, gradeBeltSource].forEach(source => {
      expect(source).to.include('getFFmpegCapability()');
      expect(source).to.include('audio analysis skipped');
      expect(source).to.include('publicFFmpegCapabilityStatus(capability)');
      expect(source).to.not.include("require('./audio_analyzer');");
    });
  });
});
