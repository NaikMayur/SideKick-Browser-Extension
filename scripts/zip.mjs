// Packages a directory into a zip archive using native Node zlib and fs.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { deflateRawSync } from "node:zlib"

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
	let c = n
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

function crc32(bytes) {
	let crc = 0xffffffff
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

function walk(dir) {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry)
		return statSync(full).isDirectory() ? walk(full) : [full]
	})
}

// Fixed DOS timestamp (1980-01-01) keeps archives byte-identical between builds.
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1

export function zipDirectory(dir, outFile) {
	const locals = []
	const centrals = []
	let offset = 0
	for (const file of walk(dir).sort()) {
		const name = Buffer.from(relative(dir, file).split(sep).join("/"))
		const data = readFileSync(file)
		const packed = deflateRawSync(data, { level: 9 })
		const stored = packed.length >= data.length
		const body = stored ? data : packed
		const crc = crc32(data)

		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0x0800, 6)
		local.writeUInt16LE(stored ? 0 : 8, 8)
		local.writeUInt16LE(DOS_TIME, 10)
		local.writeUInt16LE(DOS_DATE, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(body.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(name.length, 26)
		locals.push(local, name, body)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0x0800, 8)
		central.writeUInt16LE(stored ? 0 : 8, 10)
		central.writeUInt16LE(DOS_TIME, 12)
		central.writeUInt16LE(DOS_DATE, 14)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(body.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(name.length, 28)
		central.writeUInt32LE(offset, 42)
		centrals.push(central, name)

		offset += local.length + name.length + body.length
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(centrals.length / 2, 8)
	end.writeUInt16LE(centrals.length / 2, 10)
	end.writeUInt32LE(centralSize, 12)
	end.writeUInt32LE(offset, 16)
	writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]))
}
