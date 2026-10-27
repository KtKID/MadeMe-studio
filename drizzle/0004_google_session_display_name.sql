-- 追加可空列：Google ID token `name` 声明（已清洗、最长 64 码点），仅用于作者本人界面显示昵称。
-- 旧会话为 NULL，界面回退显示邮箱，重新登录后写入。不保存任何 Google 令牌。
ALTER TABLE `google_author_sessions` ADD `display_name` text;
