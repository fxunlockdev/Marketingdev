/** Select through the visible shared control; read the native field only for values. */
export function selectField(control){
 return control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ds-select ")][1]').locator('select.ds-select-native');
}
export async function selectOption(control,value){
 const label=await selectField(control).evaluate((el,value)=>Array.from(el.options).find(option=>option.value===String(value))?.textContent,value);
 if(label==null)throw new Error(`No option for ${String(value)}`);
 await control.click();
 await control.page().getByRole('option',{name:label,exact:true}).click();
}
export async function setSelectedOption(control,label,selected){
 await control.click();
 const option=control.page().getByRole('option',{name:label,exact:true});
 if((await option.getAttribute('aria-selected')==='true')!==selected)await option.click();
 await control.page().keyboard.press('Escape');
}
