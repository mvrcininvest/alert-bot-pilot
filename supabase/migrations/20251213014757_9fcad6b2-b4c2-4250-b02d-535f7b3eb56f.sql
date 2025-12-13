-- 1. Usuń błędną policy która pozwala wszystkim na dostęp do wszystkich pozycji
DROP POLICY IF EXISTS "Service role can do all operations on positions" ON positions;

-- 2. Dodaj policy dla UPDATE - użytkownicy mogą aktualizować tylko swoje pozycje
CREATE POLICY "Users can update their own positions" 
ON positions FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 3. Dodaj policy dla DELETE - użytkownicy mogą usuwać tylko swoje pozycje
CREATE POLICY "Users can delete their own positions" 
ON positions FOR DELETE 
USING (auth.uid() = user_id);