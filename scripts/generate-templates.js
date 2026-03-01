import fs from 'fs'
import path from 'path'
import { utils, writeFile } from 'xlsx'

const outputDir = path.join(process.cwd(), 'public', 'templates')
const outputFile = path.join(outputDir, 'import-product-variants.xlsx')

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

const headers = [
  'product_name',
  'category_name',
  'unit_code',
  'description',
  'variant_name',
  'initial_stock',
  'unit_cost',
  'unit_price',
  'tax_code',
  'price_includes_tax',
  'inventory_type',
  'is_active',
  'control_expiration',
  'is_component',
  'location_code'
]

const sampleRow = {
  product_name: 'Camiseta Básica',
  category_name: 'Camisetas',
  unit_code: 'UND',
  description: 'Tela de algodón, color blanco',
  variant_name: 'Predeterminada',
  initial_stock: 100,
  unit_cost: 12000,
  unit_price: 19000,
  tax_code: 'IVA_AC',
  price_includes_tax: 'TRUE',
  inventory_type: 'REVENTA',
  is_active: 'TRUE',
  control_expiration: 'FALSE',
  is_component: 'FALSE',
  location_code: 'BODEGA_CENTRAL'
}

const units = [
  { code: 'KG', dian_code: '28', name: 'Kilogramo', description: 'Unidad de masa del sistema internacional' },
  { code: 'GR', dian_code: 'GRM', name: 'Gramo', description: 'Unidad de masa, milésima parte del kilogramo' },
  { code: 'MG', dian_code: 'MGM', name: 'Miligramo', description: 'Unidad de masa, milésima parte del gramo' },
  { code: 'TON', dian_code: 'TNE', name: 'Tonelada', description: 'Unidad de masa, 1000 kilogramos' },
  { code: 'LB', dian_code: 'LBR', name: 'Libra', description: 'Unidad de masa, aproximadamente 0.453592 kg' },
  { code: 'OZ', dian_code: 'ONZ', name: 'Onza', description: 'Unidad de masa, 1/16 de libra' },
  { code: 'LT', dian_code: 'LTR', name: 'Litro', description: 'Unidad de volumen del sistema internacional' },
  { code: 'ML', dian_code: 'MLT', name: 'Mililitro', description: 'Unidad de volumen, milésima parte del litro' },
  { code: 'CM3', dian_code: 'CMQ', name: 'Centímetro cúbico', description: 'Unidad de volumen, equivalente a 1 mililitro' },
  { code: 'M3', dian_code: 'MTQ', name: 'Metro cúbico', description: 'Unidad de volumen, 1000 litros' },
  { code: 'GAL', dian_code: 'GLI', name: 'Galón', description: 'Unidad de volumen, 3.785411784 litros' },
  { code: 'MT', dian_code: 'MTR', name: 'Metro', description: 'Unidad de longitud del sistema internacional' },
  { code: 'CM', dian_code: 'CMT', name: 'Centímetro', description: 'Unidad de longitud, centésima parte del metro' },
  { code: 'MM', dian_code: 'MMT', name: 'Milímetro', description: 'Unidad de longitud, milésima parte del metro' },
  { code: 'KM', dian_code: 'KMT', name: 'Kilómetro', description: 'Unidad de longitud, 1000 metros' },
  { code: 'IN', dian_code: 'INH', name: 'Pulgada', description: 'Unidad de longitud, 2.54 centímetros' },
  { code: 'FT', dian_code: 'FOT', name: 'Pie', description: 'Unidad de longitud, 30.48 centímetros' },
  { code: 'YD', dian_code: 'YRD', name: 'Yarda', description: 'Unidad de longitud, 0.9144 metros' },
  { code: 'M2', dian_code: 'MTK', name: 'Metro cuadrado', description: 'Unidad de superficie del sistema internacional' },
  { code: 'CM2', dian_code: 'CMK', name: 'Centímetro cuadrado', description: 'Unidad de superficie, centésima parte del metro cuadrado' },
  { code: 'HA', dian_code: 'HAR', name: 'Hectárea', description: 'Unidad de superficie, 10000 metros cuadrados' },
  { code: 'HR', dian_code: 'HUR', name: 'Hora', description: 'Unidad de tiempo, 60 minutos' },
  { code: 'MIN', dian_code: 'MIN', name: 'Minuto', description: 'Unidad de tiempo, 60 segundos' },
  { code: 'SEG', dian_code: 'SEC', name: 'Segundo', description: 'Unidad de tiempo del sistema internacional' },
  { code: 'DIA', dian_code: 'DAY', name: 'Día', description: 'Unidad de tiempo, 24 horas' },
  { code: 'MES', dian_code: 'MON', name: 'Mes', description: 'Unidad de tiempo, aproximadamente 30 días' },
  { code: 'ANO', dian_code: 'ANN', name: 'Año', description: 'Unidad de tiempo, 365 días' },
  { code: 'UND', dian_code: '94', name: 'Unidad', description: 'Unidad individual de producto' },
  { code: 'PAR', dian_code: 'PR', name: 'Par', description: 'Conjunto de dos unidades' },
  { code: 'DOCENA', dian_code: 'DZN', name: 'Docena', description: 'Conjunto de 12 unidades' },
  { code: 'CIENTO', dian_code: 'CEN', name: 'Ciento', description: 'Conjunto de 100 unidades' },
  { code: 'MILLAR', dian_code: 'MIL', name: 'Millar', description: 'Conjunto de 1000 unidades' },
  { code: 'CAJA', dian_code: 'BX', name: 'Caja', description: 'Empaque tipo caja' },
  { code: 'PAQUETE', dian_code: 'PK', name: 'Paquete', description: 'Empaque tipo paquete' },
  { code: 'BOLSA', dian_code: 'BG', name: 'Bolsa', description: 'Empaque tipo bolsa' },
  { code: 'ROLLO', dian_code: 'RO', name: 'Rollo', description: 'Empaque tipo rollo' },
  { code: 'BOTELLA', dian_code: 'BO', name: 'Botella', description: 'Empaque tipo botella' },
  { code: 'FRASCO', dian_code: 'VI', name: 'Frasco', description: 'Empaque tipo frasco o vial' },
  { code: 'KWH', dian_code: 'KWH', name: 'Kilovatio-hora', description: 'Unidad de energía eléctrica' },
  { code: 'SERV', dian_code: 'E48', name: 'Servicio', description: 'Unidad de servicio prestado' },
  { code: 'ACT', dian_code: 'ACT', name: 'Actividad', description: 'Unidad de actividad realizada' }
]

const workbook = utils.book_new()
const productSheet = utils.json_to_sheet([sampleRow], { header: headers })

const instructions = [
  ['INSTRUCCIONES'],
  ['1. llenar solo las columnas listadas arriba.'],
  ['2. unit_code debe coincidir con ulls de la hoja unidades_dian.'],
  ['3. Deja variant_name en blanco para usar la variante predeterminada.']
]

utils.sheet_add_aoa(productSheet, instructions, { origin: -1 })
utils.book_append_sheet(workbook, productSheet, 'productos')

const unitsSheet = utils.json_to_sheet(units, {
  header: ['code', 'dian_code', 'name', 'description']
})
utils.book_append_sheet(workbook, unitsSheet, 'unidades_dian')

writeFile(workbook, outputFile)
console.log('Plantilla generada en', outputFile)
