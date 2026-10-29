/** 仅静态SQL片段；所有用户值必须bind，禁止拼接类型名称或ID。 */
export const ARTICLE_TYPE_EXISTS_SQL = `EXISTS (SELECT 1 FROM json_each(COALESCE((SELECT json_extract(document_json,'$.articleTypes') FROM settings WHERE id=1), ?)) WHERE json_extract(value,'$.id')=?)`;
export const ARTICLE_TYPE_REFERENCED_SQL = `EXISTS (SELECT 1 FROM posts WHERE
  json_extract(document_json,'$.categoryId')=? OR (json_extract(document_json,'$.categoryId') IS NULL AND json_extract(document_json,'$.category') IN (SELECT value FROM json_each(?))) OR
  json_extract(published_json,'$.categoryId')=? OR (json_extract(published_json,'$.categoryId') IS NULL AND json_extract(published_json,'$.category') IN (SELECT value FROM json_each(?))))`;
