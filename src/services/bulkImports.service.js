import { supabase } from '../lib/supabase';

const importsCols =
  'import_id, tenant_id, import_type, file_name, status, processed_count, error_count, created_at';

export async function listBulkImports({ tenantId, importType = null, limit = 50 } = {}) {
  try {
    let query = supabase
      .from('bulk_imports')
      .select(importsCols)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (importType) {
      query = query.eq('import_type', importType);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listBulkImportErrors(importId) {
  try {
    const { data, error } = await supabase
      .from('bulk_import_errors')
      .select('error_id,row_number,detail,raw_data,created_at')
      .eq('import_id', importId)
      .order('row_number', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}
