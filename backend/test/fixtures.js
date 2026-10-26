import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function createDatabase(schema) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);

  function statement(sql, values = []) {
    return {
      bind(...parameters) {
        return statement(sql, parameters);
      },
      async run() {
        const prepared = sqlite.prepare(sql);
        if (prepared.columns().length) {
          return { success: true, results: prepared.all(...values), meta: {} };
        }
        const result = prepared.run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
      async all() {
        return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} };
      },
      async first(column) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
    };
  }

  return {
    sqlite,
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createBucket() {
  const entries = new Map();
  const multipartUploads = new Map();
  let nextUploadId = 0;

  function metadata(entry) {
    return {
      key: entry.key,
      size: entry.bytes.byteLength,
      uploaded: entry.uploaded,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      writeHttpMetadata(headers) {
        if (entry.httpMetadata?.contentType) headers.set('Content-Type', entry.httpMetadata.contentType);
      },
    };
  }

  function store(key, bytes, options = {}) {
    const entry = {
      key,
      bytes,
      uploaded: new Date(),
      etag: createHash('sha256').update(bytes).digest('hex'),
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata,
    };
    entries.set(key, entry);
    return metadata(entry);
  }

  function multipartHandle(key, uploadId) {
    function activeUpload() {
      const upload = multipartUploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error('Multipart upload does not exist.');
      return upload;
    }

    return {
      key,
      uploadId,
      async uploadPart(partNumber, body) {
        activeUpload();
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
          throw new Error('Invalid multipart part number.');
        }
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        const etag = createHash('sha256').update(bytes).digest('hex');
        activeUpload().parts.set(partNumber, { bytes, etag });
        return { partNumber, etag };
      },
      async complete(parts) {
        const upload = activeUpload();
        if (!Array.isArray(parts) || parts.length === 0) {
          throw new Error('Multipart completion requires uploaded parts.');
        }
        let previousPartNumber = 0;
        const selectedParts = parts.map((part) => {
          const storedPart = upload.parts.get(part?.partNumber);
          if (!storedPart || part.partNumber <= previousPartNumber || part.etag !== storedPart.etag) {
            throw new Error('Multipart completion contains invalid or unordered parts.');
          }
          previousPartNumber = part.partNumber;
          return storedPart;
        });
        const bytes = new Uint8Array(selectedParts.reduce((size, part) => size + part.bytes.byteLength, 0));
        let offset = 0;
        for (const part of selectedParts) {
          bytes.set(part.bytes, offset);
          offset += part.bytes.byteLength;
        }
        const result = store(key, bytes, upload.options);
        multipartUploads.delete(uploadId);
        return result;
      },
      async abort() {
        activeUpload();
        multipartUploads.delete(uploadId);
      },
    };
  }

  return {
    entries,
    multipartUploads,
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      return store(key, bytes, options);
    },
    async createMultipartUpload(key, options = {}) {
      const uploadId = `multipart-${++nextUploadId}`;
      multipartUploads.set(uploadId, { key, options, parts: new Map() });
      return multipartHandle(key, uploadId);
    },
    resumeMultipartUpload(key, uploadId) {
      return multipartHandle(key, uploadId);
    },
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      return { ...metadata(entry), body: new Response(entry.bytes).body };
    },
    async head(key) {
      const entry = entries.get(key);
      return entry ? metadata(entry) : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
    },
    async list(options = {}) {
      const candidates = [...entries.values()]
        .filter((entry) => !options.prefix || entry.key.startsWith(options.prefix))
        .sort((left, right) => left.key.localeCompare(right.key));
      const offset = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = candidates.slice(offset, offset + limit);
      const truncated = offset + page.length < candidates.length;
      return {
        objects: page.map(metadata),
        truncated,
        cursor: truncated ? String(offset + page.length) : undefined,
        delimitedPrefixes: [],
      };
    },
  };
}
