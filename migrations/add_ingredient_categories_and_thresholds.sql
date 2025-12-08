-- Migration: Add ingredient categories and stock thresholds
-- This allows restaurants to manage stock levels by category

-- 1. Create ingredient_categories table
CREATE TABLE IF NOT EXISTS public.ingredient_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  -- Stock threshold percentages (relative to safety_stock)
  critical_threshold numeric NOT NULL DEFAULT 0.5 CHECK (critical_threshold >= 0 AND critical_threshold <= 1),
  low_threshold numeric NOT NULL DEFAULT 1.0 CHECK (low_threshold >= 0 AND low_threshold <= 2),
  ok_threshold numeric NOT NULL DEFAULT 1.5 CHECK (ok_threshold >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_categories_pkey PRIMARY KEY (id),
  CONSTRAINT ingredient_categories_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
  CONSTRAINT ingredient_categories_unique_name UNIQUE (restaurant_id, name)
);

-- 2. Add category_id column to ingredients table
ALTER TABLE public.ingredients 
ADD COLUMN IF NOT EXISTS category_id uuid,
ADD CONSTRAINT ingredients_category_id_fkey 
  FOREIGN KEY (category_id) REFERENCES public.ingredient_categories(id) ON DELETE SET NULL;

-- 3. Create index for better performance
CREATE INDEX IF NOT EXISTS idx_ingredients_category_id ON public.ingredients(category_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_categories_restaurant_id ON public.ingredient_categories(restaurant_id);

-- 4. Insert default categories for existing restaurants
INSERT INTO public.ingredient_categories (restaurant_id, name, description, critical_threshold, low_threshold, ok_threshold)
SELECT DISTINCT 
  r.id as restaurant_id,
  'Frais' as name,
  'Produits frais (fruits, légumes, viandes, poissons)' as description,
  0.3 as critical_threshold,  -- Critical when stock < 30% of safety stock
  0.8 as low_threshold,       -- Low when stock < 80% of safety stock
  1.2 as ok_threshold         -- OK when stock >= 120% of safety stock
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_categories ic 
  WHERE ic.restaurant_id = r.id AND ic.name = 'Frais'
);

INSERT INTO public.ingredient_categories (restaurant_id, name, description, critical_threshold, low_threshold, ok_threshold)
SELECT DISTINCT 
  r.id as restaurant_id,
  'Sec' as name,
  'Produits secs (pâtes, riz, farine, épices)' as description,
  0.5 as critical_threshold,  -- Critical when stock < 50% of safety stock
  1.0 as low_threshold,       -- Low when stock < 100% of safety stock
  1.5 as ok_threshold         -- OK when stock >= 150% of safety stock
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_categories ic 
  WHERE ic.restaurant_id = r.id AND ic.name = 'Sec'
);

INSERT INTO public.ingredient_categories (restaurant_id, name, description, critical_threshold, low_threshold, ok_threshold)
SELECT DISTINCT 
  r.id as restaurant_id,
  'Surgelé' as name,
  'Produits surgelés' as description,
  0.4 as critical_threshold,  -- Critical when stock < 40% of safety stock
  0.9 as low_threshold,       -- Low when stock < 90% of safety stock
  1.3 as ok_threshold         -- OK when stock >= 130% of safety stock
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_categories ic 
  WHERE ic.restaurant_id = r.id AND ic.name = 'Surgelé'
);

INSERT INTO public.ingredient_categories (restaurant_id, name, description, critical_threshold, low_threshold, ok_threshold)
SELECT DISTINCT 
  r.id as restaurant_id,
  'Boissons' as name,
  'Boissons (alcoolisées et non-alcoolisées)' as description,
  0.5 as critical_threshold,  -- Critical when stock < 50% of safety stock
  1.0 as low_threshold,       -- Low when stock < 100% of safety stock
  1.5 as ok_threshold         -- OK when stock >= 150% of safety stock
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_categories ic 
  WHERE ic.restaurant_id = r.id AND ic.name = 'Boissons'
);

INSERT INTO public.ingredient_categories (restaurant_id, name, description, critical_threshold, low_threshold, ok_threshold)
SELECT DISTINCT 
  r.id as restaurant_id,
  'Autre' as name,
  'Autres ingrédients' as description,
  0.5 as critical_threshold,  -- Critical when stock < 50% of safety stock
  1.0 as low_threshold,       -- Low when stock < 100% of safety stock
  1.5 as ok_threshold         -- OK when stock >= 150% of safety stock
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_categories ic 
  WHERE ic.restaurant_id = r.id AND ic.name = 'Autre'
);

-- 5. Add comments for documentation
COMMENT ON TABLE public.ingredient_categories IS 'Categories for ingredients with customizable stock thresholds per restaurant';
COMMENT ON COLUMN public.ingredient_categories.critical_threshold IS 'Threshold multiplier for CRITICAL status (e.g., 0.5 = 50% of safety_stock)';
COMMENT ON COLUMN public.ingredient_categories.low_threshold IS 'Threshold multiplier for LOW status (e.g., 1.0 = 100% of safety_stock)';
COMMENT ON COLUMN public.ingredient_categories.ok_threshold IS 'Threshold multiplier for OK status (e.g., 1.5 = 150% of safety_stock)';
