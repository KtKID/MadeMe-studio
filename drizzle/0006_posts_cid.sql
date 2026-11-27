CREATE UNIQUE INDEX posts_cid_unique ON posts(json_extract(document_json, '$.cid'));
