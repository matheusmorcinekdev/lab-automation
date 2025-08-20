
//check iai ads
document.querySelectorAll('.fs-iai').forEach((slot, i) => {
    const loaded = slot.querySelector('[id$="_slot"]')?.children.length > 0;
    const rect = slot.getBoundingClientRect();
    const distance = Math.round((rect.top - window.innerHeight) / window.innerHeight * 100);
    console.log(`${loaded ? '✅' : '❌'} Slot ${i}: ${slot.id} | ${distance}% from viewport`);
});