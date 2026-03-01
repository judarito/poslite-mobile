-- ===================================================================
-- Migración: Tablas lookup para Terceros
-- Fecha: 2026-02-21
-- Crea tablas: document_types, departments, cities y semillas básicas (Colombia)
-- ===================================================================

DO $$ BEGIN RAISE NOTICE '✅ Creando lookups para terceros'; END $$;

-- Document types (DIAN common codes or friendly labels)
CREATE TABLE IF NOT EXISTS document_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

INSERT INTO document_types (code, label)
VALUES
  ('13','NIT'),
  ('31','Cédula de Ciudadanía'),
  ('22','Cédula de Extranjería'),
  ('11','Tarjeta de Identidad'),
  ('12','Registro Civil'),
  ('80','Pasaporte')
ON CONFLICT (code) DO NOTHING;

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  department_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL
);

INSERT INTO departments (code, name)
VALUES
  ('DC','Distrito Capital (Bogotá)'),
  ('ANT','Antioquia'),
  ('CUN','Cundinamarca'),
  ('VAL','Valle del Cauca')
ON CONFLICT (code) DO NOTHING;

-- Cities linked to departments
CREATE TABLE IF NOT EXISTS cities (
  city_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES departments(department_id) ON DELETE SET NULL,
  name TEXT NOT NULL
);

-- Seed a few cities (link by department code)
DO $$
DECLARE d RECORD;
BEGIN
  SELECT department_id INTO d FROM departments WHERE code = 'DC' LIMIT 1;
  IF d IS NOT NULL THEN
    INSERT INTO cities (department_id, name) VALUES (d.department_id, 'Bogotá D.C.') ON CONFLICT DO NOTHING;
  END IF;

  SELECT department_id INTO d FROM departments WHERE code = 'ANT' LIMIT 1;
  IF d IS NOT NULL THEN
    INSERT INTO cities (department_id, name) VALUES (d.department_id, 'Medellín') ON CONFLICT DO NOTHING;
  END IF;

  SELECT department_id INTO d FROM departments WHERE code = 'CUN' LIMIT 1;
  IF d IS NOT NULL THEN
    INSERT INTO cities (department_id, name) VALUES (d.department_id, 'Soacha') ON CONFLICT DO NOTHING;
  END IF;

  SELECT department_id INTO d FROM departments WHERE code = 'VAL' LIMIT 1;
  IF d IS NOT NULL THEN
    INSERT INTO cities (department_id, name) VALUES (d.department_id, 'Cali') ON CONFLICT DO NOTHING;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✓ Lookups creados y semillas insertadas'; END $$;
