/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { neutralizeEmptySdtpBoxes } from '@peertube/peertube-server/core/helpers/ffmpeg/fmp4.js'
import { expect } from 'chai'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

function box (type: string, ...children: Buffer[]) {
  const body = Buffer.concat(children)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length)
  header.write(type, 4, 'latin1')

  return Buffer.concat([ header, body ])
}

// Version and flags, then the sample entries
function sdtp (entries: number) {
  return box('sdtp', Buffer.alloc(4), Buffer.alloc(entries, 0x08))
}

function buildFragmentedMP4 (sdtpBox: Buffer) {
  return Buffer.concat([
    box('ftyp', Buffer.from('iso5\0\0\x02\0iso5iso6mp41', 'latin1')),
    box('moov', box('mvhd', Buffer.alloc(100)), box('trak', box('mdia', box('minf', box('stbl', box('stsd', Buffer.alloc(8)), sdtpBox))))),
    box('moof', box('mfhd', Buffer.alloc(8))),
    box('mdat', box('sdtp', Buffer.alloc(4)))
  ])
}

describe('Fragmented MP4 helpers', function () {
  const path = join(tmpdir(), 'peertube-test-fmp4.mp4')

  it('Should rename an empty sdtp box of the moov to free', async function () {
    const original = buildFragmentedMP4(sdtp(0))
    await writeFile(path, original)

    expect(await neutralizeEmptySdtpBoxes(path)).to.equal(1)

    const patched = await readFile(path)
    const moovSdtpOffset = original.indexOf('sdtp', 0, 'latin1')

    expect(patched).to.have.lengthOf(original.length)
    expect(patched.toString('latin1', moovSdtpOffset, moovSdtpOffset + 4)).to.equal('free')
    expect(patched.subarray(0, moovSdtpOffset)).to.deep.equal(original.subarray(0, moovSdtpOffset))
    expect(patched.subarray(moovSdtpOffset + 4)).to.deep.equal(original.subarray(moovSdtpOffset + 4))
  })

  it('Should keep an sdtp box that has sample entries', async function () {
    const original = buildFragmentedMP4(sdtp(3))
    await writeFile(path, original)

    expect(await neutralizeEmptySdtpBoxes(path)).to.equal(0)
    expect(await readFile(path)).to.deep.equal(original)
  })

  it('Should not touch a file without a moov box', async function () {
    const original = Buffer.concat([ box('ftyp', Buffer.alloc(8)), box('mdat', sdtp(0)) ])
    await writeFile(path, original)

    expect(await neutralizeEmptySdtpBoxes(path)).to.equal(0)
    expect(await readFile(path)).to.deep.equal(original)
  })

  after(async function () {
    await rm(path, { force: true })
  })
})
