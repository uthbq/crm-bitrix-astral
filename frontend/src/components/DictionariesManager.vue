<template>
  <div class="dictionaries-manager">
    <h2 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px;">Управление справочниками</h2>
    
    <div class="split-layout">
      <div class="card">
        <h3>📦 Продукты</h3>
        <div class="add-form">
          <input v-model="newProductName" placeholder="Например, ККТ" @keyup.enter="addProduct" />
          <button @click="addProduct" class="btn-add">+</button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>ID</th><th>Название</th><th style="width: 40px;"></th></tr></thead>
            <tbody>
              <tr v-if="products.length === 0"><td colspan="3" class="empty">Нет данных</td></tr>
              <tr v-for="product in products" :key="product.id">
                <td>{{ product.id }}</td>
                <td>{{ product.name }}</td>
                <td style="text-align: center;"><button @click="deleteProduct(product.id)" class="btn-delete">✖</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="flex: 1.5;">
        <h3>📁 Базы для прозвона</h3>
        <div class="add-form">
          <input v-model="newBaseName" placeholder="Например, Теплая база" style="flex: 2;" />
          <select v-model="newBaseProductId" style="flex: 1.5;">
            <option value="">Основной продукт</option>
            <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button @click="addBase" class="btn-add">Добавить</button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>ID</th><th>Название</th><th>Осн. продукт</th><th style="width: 40px;"></th></tr></thead>
            <tbody>
              <tr v-if="bases.length === 0"><td colspan="4" class="empty">Нет данных</td></tr>
              <tr v-for="base in bases" :key="base.id">
                <td>{{ base.id }}</td>
                <td>{{ base.name }}</td>
                <td>{{ getProductName(base.main_product_id) }}</td>
                <td style="text-align: center;"><button @click="deleteBase(base.id)" class="btn-delete">✖</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>🛑 Причины отказов</h3>
        <div class="add-form">
          <input v-model="newReasonName" placeholder="Например, Дорого" @keyup.enter="addReason" />
          <button @click="addReason" class="btn-add">+</button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>ID</th><th>Причина</th><th style="width: 40px;"></th></tr></thead>
            <tbody>
              <tr v-if="reasons.length === 0"><td colspan="3" class="empty">Нет данных</td></tr>
              <tr v-for="reason in reasons" :key="reason.id">
                <td>{{ reason.id }}</td>
                <td>{{ reason.name }}</td>
                <td style="text-align: center;"><button @click="deleteReason(reason.id)" class="btn-delete">✖</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card constructor-card">
      <div class="constructor-header">
        <h3>⚙️ Конструктор конверсий по базам</h3>
        <p class="subtitle">Настройте индивидуальные формулы расчета конверсии для каждой базы</p>
      </div>

      <div class="constructor-form">
        <div class="form-group">
          <label>База (срез)</label>
          <select v-model="newRule.base_id" class="input-light">
            <option value="" disabled>Выберите базу</option>
            <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>Целевое событие (Числитель)</label>
          <select v-model="newRule.numerator" class="input-light">
            <option value="quality_leads">Качественные лиды</option>
            <option value="paid_deals">Оплаты (Сделки)</option>
            <option value="transfers">Передачи в корп</option>
          </select>
        </div>

        <div class="form-group">
          <label>Исходная база (Знаменатель)</label>
          <select v-model="newRule.denominator" class="input-light">
            <option value="unique_leads">Взятые в работу лиды</option>
            <option value="total_calls">Все наборы (Звонки)</option>
            <option value="valid_conversations">Разговоры</option>
          </select>
        </div>

        <div class="form-group">
          <label>Продукт</label>
          <select v-model="newRule.product_type" class="input-light">
            <option value="all">Любой</option>
            <option value="main">Только основной</option>
            <option value="cross">Только кросс</option>
          </select>
        </div>

        <div class="form-group">
          <label>Цикл работы</label>
          <select v-model="newRule.cycle_type" class="input-light">
            <option value="all">Все циклы</option>
            <option value="primary">Только первичный</option>
            <option value="return">Возврат / Догрев</option>
          </select>
        </div>

        <div class="form-group" style="flex: 0.5;">
          <label>&nbsp;</label>
          <button @click="saveRule" class="btn-save-rule">Сохранить</button>
        </div>
      </div>

      <div class="mandatory-exclusion">
        <span class="lock-icon">🔒</span>
        <strong>Обязательное исключение:</strong> Лиды в стадии «Импорт / Поступило» автоматически исключаются из знаменателя "Взятые в работу" по системному правилу.
      </div>

      <div class="table-responsive" style="margin-top: 20px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>База</th>
              <th>Формула (Числитель / Знаменатель)</th>
              <th>Продукт</th>
              <th>Цикл</th>
              <th style="width: 80px; text-align: center;">Версия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="rules.length === 0"><td colspan="5" class="empty">Правила не настроены. Расчет идет по умолчанию.</td></tr>
            <tr v-for="rule in rules" :key="rule.id">
              <td><strong>{{ rule.base_name }}</strong></td>
              <td style="color: #34495e;">{{ formatFormula(rule.numerator) }} <strong>/</strong> {{ formatFormula(rule.denominator) }}</td>
              <td style="color: #7f8c8d;">{{ translateFilter(rule.product_type) }}</td>
              <td style="color: #7f8c8d;">{{ translateFilter(rule.cycle_type) }}</td>
              <td style="text-align: center; color: #7f8c8d;">v.{{ rule.version }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Product { id: number; name: string; }
interface Base { id: number; name: string; main_product_id: number | null; }
interface Reason { id: number; name: string; }
interface ConversionRule { id: number; base_id: number; base_name: string; numerator: string; denominator: string; calc_type: string; product_type: string; cycle_type: string; version: number; }

const products = ref<Product[]>([]);
const bases = ref<Base[]>([]);
const reasons = ref<Reason[]>([]);
const rules = ref<ConversionRule[]>([]);

const newProductName = ref('');
const newBaseName = ref('');
const newBaseProductId = ref<number | ''>('');
const newReasonName = ref('');

const newRule = ref({
  base_id: '',
  numerator: 'quality_leads',
  denominator: 'unique_leads',
  calc_type: 'уникальные лиды',
  product_type: 'all',
  cycle_type: 'all'
});

const vocab: Record<string, string> = {
  quality_leads: 'Качественные лиды',
  paid_deals: 'Оплаты',
  transfers: 'Передачи',
  unique_leads: 'Взятые в работу',
  total_calls: 'Все наборы',
  valid_conversations: 'Разговоры'
};

const formatFormula = (key: string) => vocab[key] || key;
const translateFilter = (val: string) => {
  if (val === 'main') return 'Основной';
  if (val === 'cross') return 'Кросс';
  if (val === 'primary') return 'Первичный';
  if (val === 'return') return 'Возврат';
  return 'Любой';
};

const loadProducts = async () => {
  try { products.value = await (await fetch('http://localhost:3000/api/products')).json(); } catch (e) {}
};
const addProduct = async () => {
  if (!newProductName.value.trim()) return;
  const res = await fetch('http://localhost:3000/api/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newProductName.value.trim() })
  });
  if (res.ok) { newProductName.value = ''; await loadProducts(); } else alert((await res.json()).error);
};
const deleteProduct = async (id: number) => {
  if (confirm('Удалить продукт?')) { await fetch(`http://localhost:3000/api/products/${id}`, { method: 'DELETE' }); await loadProducts(); await loadBases(); }
};

const loadBases = async () => {
  try { bases.value = await (await fetch('http://localhost:3000/api/bases')).json(); } catch (e) {}
};
const addBase = async () => {
  if (!newBaseName.value.trim()) return;
  const res = await fetch('http://localhost:3000/api/bases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newBaseName.value.trim(), main_product_id: newBaseProductId.value || null })
  });
  if (res.ok) { newBaseName.value = ''; newBaseProductId.value = ''; await loadBases(); } else alert((await res.json()).error);
};
const deleteBase = async (id: number) => {
  if (confirm('Удалить базу? Связанные правила конверсии также будут удалены.')) { 
    await fetch(`http://localhost:3000/api/bases/${id}`, { method: 'DELETE' }); 
    await loadBases(); await loadRules();
  }
};
const getProductName = (id: number | null) => {
  if (!id) return '-';
  const p = products.value.find(prod => prod.id === id);
  return p ? p.name : 'Удален';
};

const loadReasons = async () => {
  try { reasons.value = await (await fetch('http://localhost:3000/api/refusal-reasons')).json(); } catch (e) {}
};
const addReason = async () => {
  if (!newReasonName.value.trim()) return;
  const res = await fetch('http://localhost:3000/api/refusal-reasons', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newReasonName.value.trim() })
  });
  if (res.ok) { newReasonName.value = ''; await loadReasons(); } else alert((await res.json()).error);
};
const deleteReason = async (id: number) => {
  if (confirm('Удалить причину?')) { await fetch(`http://localhost:3000/api/refusal-reasons/${id}`, { method: 'DELETE' }); await loadReasons(); }
};

const loadRules = async () => {
  try { rules.value = await (await fetch('http://localhost:3000/api/conversions')).json(); } catch (e) {}
};
const saveRule = async () => {
  if (!newRule.value.base_id) return alert('Выберите базу');
  
  const res = await fetch('http://localhost:3000/api/conversions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newRule.value)
  });
  
  if (res.ok) { 
    newRule.value.base_id = ''; 
    await loadRules(); 
  } else {
    const errData = await res.json();
    alert(`❌ ${errData.error}`);
  }
};

onMounted(() => {
  loadProducts();
  loadBases();
  loadReasons();
  loadRules();
});
</script>

<style scoped>
.dictionaries-manager { width: 100%; font-family: Arial, sans-serif; }
.split-layout { display: flex; gap: 20px; margin-top: 20px; align-items: flex-start; flex-wrap: wrap; }
.card { flex: 1; min-width: 300px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; overflow: hidden; }
.card h3 { margin-top: 0; color: #34495e; font-size: 16px; margin-bottom: 15px; }

.constructor-card { width: 100%; margin-top: 30px; flex: none; max-width: 100%; border-top: 4px solid #9b59b6; }
.constructor-header h3 { font-size: 18px; margin-bottom: 5px; color: #2c3e50; }
.subtitle { color: #7f8c8d; font-size: 13px; margin-top: 0; margin-bottom: 20px; }
.constructor-form { display: flex; gap: 15px; align-items: flex-end; flex-wrap: wrap; background: #fdfdfd; padding: 20px; border-radius: 8px; border: 1px solid #eee; margin-bottom: 15px; }
.form-group { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-size: 11px; font-weight: bold; color: #34495e; text-transform: uppercase; letter-spacing: 0.5px; }

.input-light { padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; width: 100%; font-size: 13px; background: white; color: #2c3e50; }

.btn-save-rule { background: #9b59b6; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; font-size: 14px; transition: background 0.2s; height: 39px; white-space: nowrap; }
.btn-save-rule:hover { background: #8e44ad; }

.mandatory-exclusion { background: #fffcf5; border: 1px solid #f39c12; padding: 12px 15px; border-radius: 6px; font-size: 13px; color: #d35400; display: flex; align-items: center; gap: 10px; }
.lock-icon { font-size: 16px; }

.add-form { display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap; }
.add-form input, .add-form select { padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; flex: 1; min-width: 120px; font-size: 13px; background: white; color: #2c3e50; }

.btn-add { background: #2ecc71; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; flex-shrink: 0; white-space: nowrap; }
.btn-add:hover { background: #27ae60; }

.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 300px; }
.data-table th, .data-table td { padding: 10px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; color: #2c3e50; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: normal; }
.btn-delete { background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer; }
.empty { text-align: center; color: #7f8c8d; padding: 15px !important; }
</style>