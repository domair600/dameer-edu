-- منصة الضمير التعليمية
-- مخطط PostgreSQL مبدئي قابل للتوسعة. ينشأ أولاً في قاعدة بيانات dameer_edu.
-- لا يخزن رمز المعلم بصيغته الأصلية؛ يخزن تجزئته فقط.

BEGIN;

-- The project currently has only the four enum types from earlier attempts and no public tables.
-- Remove those unused types so this complete setup script can run from a clean state.
DROP TYPE IF EXISTS listing_status;
DROP TYPE IF EXISTS teacher_request_kind;
DROP TYPE IF EXISTS teacher_employment_status;
DROP TYPE IF EXISTS request_status;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE request_status AS ENUM ('pending', 'needs_changes', 'approved', 'rejected');
CREATE TYPE teacher_employment_status AS ENUM ('active', 'retired');
CREATE TYPE teacher_request_kind AS ENUM ('new_profile', 'profile_update', 'name_change');
CREATE TYPE listing_status AS ENUM ('published', 'hidden', 'deleted');

CREATE TABLE admins (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name    VARCHAR(160) NOT NULL,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schools (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    address         TEXT,
    phone           VARCHAR(40),
    whatsapp        VARCHAR(40),
    location_url    TEXT,
    description     TEXT,
    image_url       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schools_active_name ON schools (is_active, name);

CREATE TABLE subjects (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(120) NOT NULL UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE education_stages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(120) NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE grades (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stage_id        BIGINT NOT NULL REFERENCES education_stages(id) ON DELETE RESTRICT,
    name            VARCHAR(120) NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (stage_id, name),
    UNIQUE (id, stage_id)
);

-- الملف العام للمعلم/المعلمة. الاسم لا يعدل عبر نموذج المعلم؛ تنشأ له معاملة name_change.
CREATE TABLE teachers (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    full_name           VARCHAR(200) NOT NULL,
    gender              VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female')),
    employment_status   teacher_employment_status NOT NULL DEFAULT 'active',
    biography           TEXT,
    experience_years    SMALLINT CHECK (experience_years IS NULL OR experience_years >= 0),
    address             TEXT,
    photo_url           TEXT,
    home_featured       BOOLEAN NOT NULL DEFAULT FALSE,
    home_badge_text     VARCHAR(30),
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_teachers_published_name ON teachers (is_published, full_name);
CREATE INDEX idx_teachers_status ON teachers (is_published, employment_status);

-- تجزئة رمز الإدارة (ثمانية أرقام) تحفظ مستقلة عن البيانات العامة.
CREATE TABLE teacher_access_credentials (
    teacher_id      BIGINT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
    code_hash       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teacher_contacts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    contact_type    VARCHAR(20) NOT NULL CHECK (contact_type IN ('mobile', 'landline', 'whatsapp')),
    phone_number    VARCHAR(40) NOT NULL,
    label           VARCHAR(80),
    sort_order      SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_teacher_contacts_teacher ON teacher_contacts (teacher_id, sort_order);

CREATE TABLE teacher_subjects (
    teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id      BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE teacher_grade_assignments (
    teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    stage_id        BIGINT NOT NULL REFERENCES education_stages(id) ON DELETE RESTRICT,
    grade_id        BIGINT NOT NULL,
    PRIMARY KEY (teacher_id, grade_id),
    FOREIGN KEY (grade_id, stage_id) REFERENCES grades(id, stage_id) ON DELETE RESTRICT
);

CREATE TABLE teacher_schools (
    teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    role_title      VARCHAR(120),
    PRIMARY KEY (teacher_id, school_id)
);
CREATE INDEX idx_teacher_schools_school ON teacher_schools (school_id, is_current);

CREATE TABLE teacher_services (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title           VARCHAR(160) NOT NULL,
    details         TEXT,
    sort_order      SMALLINT NOT NULL DEFAULT 0
);

-- الطلبات منفصلة عن الملف المنشور كي لا يتطلب الاعتماد إعادة إدخال البيانات.
-- payload JSONB يسمح بإضافة حقول مستقبلية للطلبات دون تغيير الجدول.
CREATE TABLE teacher_requests (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_kind        teacher_request_kind NOT NULL DEFAULT 'new_profile',
    teacher_id          BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
    requested_name      VARCHAR(200),
    payload             JSONB NOT NULL,
    status              request_status NOT NULL DEFAULT 'pending',
    review_message      TEXT,
    reviewer_admin_id   BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_teacher_requests_queue ON teacher_requests (status, created_at);
CREATE INDEX idx_teacher_requests_teacher ON teacher_requests (teacher_id, created_at DESC);
CREATE INDEX idx_teacher_requests_payload ON teacher_requests USING GIN (payload);

-- إعلانات الدروس والدورات؛ تنشر بلا مراجعة بعد اعتماد بطاقة المعلم.
CREATE TABLE teacher_listings (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    teacher_id          BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title               VARCHAR(200) NOT NULL,
    listing_type        VARCHAR(30) NOT NULL CHECK (listing_type IN ('private_lesson', 'course')),
    description         TEXT NOT NULL,
    subject_id          BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
    start_date          DATE,
    grade_text          TEXT,
    stage_id            BIGINT REFERENCES education_stages(id) ON DELETE SET NULL,
    grade_id            BIGINT REFERENCES grades(id) ON DELETE SET NULL,
    location            TEXT,
    price_text          VARCHAR(120),
    image_url           TEXT,
    home_featured       BOOLEAN NOT NULL DEFAULT FALSE,
    home_badge_text     VARCHAR(30),
    status              listing_status NOT NULL DEFAULT 'published',
    published_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_bumped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (grade_id IS NULL OR stage_id IS NOT NULL)
);
CREATE INDEX idx_listings_public_feed ON teacher_listings (status, last_bumped_at DESC, id DESC);
CREATE INDEX idx_listings_teacher ON teacher_listings (teacher_id, status, created_at DESC);

-- An announcement may cover more than one subject.
CREATE TABLE teacher_listing_subjects (
    listing_id      BIGINT NOT NULL REFERENCES teacher_listings(id) ON DELETE CASCADE,
    subject_id      BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    PRIMARY KEY (listing_id, subject_id)
);
CREATE INDEX idx_listing_subjects_subject ON teacher_listing_subjects (subject_id, listing_id);

-- يسجل عمليات إعادة الإظهار، ويمكن للتطبيق السماح بها بعد مرور 72 ساعة.
CREATE TABLE listing_bump_history (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id      BIGINT NOT NULL REFERENCES teacher_listings(id) ON DELETE CASCADE,
    bumped_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listing_bumps_recent ON listing_bump_history (listing_id, bumped_at DESC);

-- طلبات إضافة/تعديل بطاقات المعلمين الراحلين. لا ترتبط برمز تحكم للمعلم.
CREATE TABLE memorial_requests (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name           VARCHAR(200) NOT NULL,
    biography           TEXT NOT NULL,
    photo_url           TEXT,
    submitted_by        VARCHAR(160),
    submitter_contact   VARCHAR(80),
    status              request_status NOT NULL DEFAULT 'pending',
    review_message      TEXT,
    reviewer_admin_id   BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memorial_requests_queue ON memorial_requests (status, created_at);

CREATE TABLE memorial_teachers (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    full_name       VARCHAR(200) NOT NULL,
    biography       TEXT NOT NULL,
    photo_url       TEXT,
    home_featured   BOOLEAN NOT NULL DEFAULT FALSE,
    home_badge_text VARCHAR(30),
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_request_id BIGINT UNIQUE REFERENCES memorial_requests(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memorial_teachers_published ON memorial_teachers (is_published, full_name);

-- شرائح الصور المتحركة في الصفحة الرئيسية، تتحكم بها الإدارة.
CREATE TABLE homepage_slides (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    image_url       TEXT NOT NULL,
    title           VARCHAR(200),
    subtitle        TEXT,
    link_url        TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_homepage_slides_active ON homepage_slides (is_active, sort_order);

-- سجل مراجعات وتغييرات إداري قابل للتدقيق.
CREATE TABLE admin_audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id        BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    entity_type     VARCHAR(60) NOT NULL,
    entity_id       BIGINT NOT NULL,
    action          VARCHAR(60) NOT NULL,
    details         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_entity ON admin_audit_log (entity_type, entity_id, created_at DESC);

COMMIT;

-- ملاحظات تنفيذية:
-- 1) أنشئ قاعدة البيانات مرة واحدة من أداة الإدارة: CREATE DATABASE dameer_edu;
--    ثم اتصل بها وشغّل هذا الملف.
-- 2) خزّن رمز التحكم باستخدام تجزئة آمنة (مثل bcrypt/Argon2) في code_hash؛ لا تحفظ الرمز نصاً.
-- 3) عند اعتماد طلب new_profile: أنشئ teacher والعلاقات والرمز من الطلب نفسه داخل معاملة واحدة.
-- 4) اجعل تحديث الاسم متاحاً للإدارة فقط، عبر teacher_requests من النوع name_change.
-- 5) تحقق من أهلية إعادة نشر الإعلان في التطبيق/الخدمة: آخر bump أقدم من now() - interval '72 hours'.
-- 6) استخدم استعلامات LIMIT/OFFSET أو keyset pagination لعرض النتائج على دفعات من 20.
