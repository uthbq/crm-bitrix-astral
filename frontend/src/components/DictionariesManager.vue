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

      <div class="card">
        <h3>🛑 Причины отказов</h3>
        <div class="add-form">
          <input v-model="newReasonName" placeholder="Например, Дорого" @keyup.enter="addReason" />
          <button @click="addReason" class="btn-add">+</button>
        </div>
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
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Product { id: number; name: string; }
interface Base { id: number; name: string; main_product_id: number | null; }
interface Reason { id: number; name: string; }

const products = ref<Product[]>([]);
const bases = ref<Base[]>([]);
const reasons = ref<Reason[]>([]);

const newProductName = ref('');
const newBaseName = ref('');
const newBaseProductId = ref<number | ''>('');
const newReasonName = ref('');

const loadProducts = async () => {
  try { products.value = await (await fetch('http://localhost:3000/api/products')).json(); } catch (e) { }
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
  try { bases.value = await (await fetch('http://localhost:3000/api/bases')).json(); } catch (e) { }
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
  if (confirm('Удалить базу?')) { await fetch(`http://localhost:3000/api/bases/${id}`, { method: 'DELETE' }); await loadBases(); }
};
const getProductName = (id: number | null) => {
  if (!id) return '-';
  const p = products.value.find(prod => prod.id === id);
  return p ? p.name : 'Удален';
};

const loadReasons = async () => {
  try { reasons.value = await (await fetch('http://localhost:3000/api/refusal-reasons')).json(); } catch (e) { }
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

onMounted(() => {
  loadProducts();
  loadBases();
  loadReasons();
});
</script>

<style scoped>
.dictionaries-manager { width: 100%; font-family: Arial, sans-serif; }
.split-layout { display: flex; gap: 20px; margin-top: 20px; align-items: flex-start; flex-wrap: wrap; }
.card { flex: 1; min-width: 300px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; }
.card h3 { margin-top: 0; color: #34495e; font-size: 16px; margin-bottom: 15px; }

.add-form { display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap; }

.add-form input, .add-form select { padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; flex: 1; min-width: 120px; font-size: 13px; }

.btn-add { background: #2ecc71; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; flex-shrink: 0; white-space: nowrap; }
.btn-add:hover { background: #27ae60; }

.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 10px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; color: #2c3e50; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: normal; }
.btn-delete { background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer; }
.empty { text-align: center; color: #7f8c8d; padding: 15px !important; }
</style>